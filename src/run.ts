import * as core from '@actions/core';
import * as github from '@actions/github';
import execa from 'execa';

async function run() {
  try {
    const token = core.getInput('github-token', { required: true });
    const branch = core.getInput('branch-name') || 'syncpack/update';
    const reviewersInput = core.getInput('reviewers') || '';
    const reviewers = reviewersInput.split(',').map(r => r.trim()).filter(r => r);
    const commitMessage = core.getInput('commit-message') || 'chore: sync package versions via Syncpack';

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const baseBranch = github.context.payload.repository?.default_branch || 'main';

    // Run syncpack
    await execa('npx', ['syncpack', 'update'], { stdio: 'inherit' });

    // Check for changed files
    const changes = await execa('git', ['status', '--porcelain']);
    if (!changes.stdout) {
      core.info('No changes detected; exiting.');
      return;
    }

    // Ensure branch exists or overwrite
    const prList = await octokit.rest.pulls.list({
      owner, repo, head: `${owner}:${branch}`, state: 'open'
    });

    if (prList.data.length > 0) {
      core.info(`Existing PR found (#${prList.data[0].number}). Force pushing to branch ${branch}`);
      // recreate branch from base
      await execa('git', ['checkout', baseBranch]);
      await execa('git', ['branch', '-D', branch]);
    }

    await execa('git', ['checkout', '-b', branch]);
    await execa('git', ['add', '.']);
    await execa('git', ['commit', '-m', commitMessage]);
    await execa('git', ['push', '--force', 'origin', branch]);

    let prNumber: number | null = null;
    if (prList.data.length > 0) {
      prNumber = prList.data[0].number;
      core.info(`Using existing PR #${prNumber}`);
    } else {
      core.info('Creating a new PR...');
      const pr = await octokit.rest.pulls.create({
        owner,
        repo,
        head: branch,
        base: baseBranch,
        title: commitMessage,
        body: 'Automated syncpack update'
      });
      prNumber = pr.data.number;
      core.info(`Created PR #${prNumber}`);
    }

    if (reviewers.length) {
      core.info(`Requesting reviewers: ${reviewers.join(', ')}`);
      await octokit.rest.pulls.requestReviewers({
        owner,
        repo,
        pull_number: prNumber!,
        reviewers,
      });
    }

    core.setOutput('pr-number', prNumber!.toString());
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

run();
