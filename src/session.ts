/**
 * Session — holds all engine instances for one workspace.
 * Created at server startup, shared across all tool handlers.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { WorkspaceConfig } from './types.js';
import { createJail, type Jail } from './lib/paths.js';
import { Gitignore } from './lib/gitignore.js';
import { CodeIndex } from './lib/index.js';
import { MemoryStore } from './lib/memory.js';
import { SnapshotStore } from './lib/snapshots.js';
import { TaskDAG } from './lib/orchestrate.js';
import { log } from './lib/log.js';

export class Session {
  config: WorkspaceConfig;
  jail: Jail;
  gitignore: Gitignore;
  index: CodeIndex;
  memory: MemoryStore;
  snapshots: SnapshotStore;
  tasks: TaskDAG;

  private constructor(config: WorkspaceConfig, jail: Jail, gitignore: Gitignore) {
    this.config = config;
    this.jail = jail;
    this.gitignore = gitignore;
    this.index = new CodeIndex(config, gitignore);
    this.memory = new MemoryStore(config.stateDir, config.maxMemoryEntries);
    this.snapshots = new SnapshotStore(config.stateDir, config.maxSnapshotBytes);
    this.tasks = new TaskDAG(config.stateDir);
  }

  static async create(root: string): Promise<Session> {
    const realRoot = await fs.realpath(root);
    const jail = await createJail(realRoot);
    const gitignore = new Gitignore(jail.root);
    await gitignore.init();
    const stateDir = path.join(jail.root, '.nexus');
    await fs.mkdir(stateDir, { recursive: true });
    const config: WorkspaceConfig = {
      root: jail.root, extraRoots: jail.extraRoots, stateDir,
      maxFileBytes: 1048576, maxWalkFiles: 60000, maxOutputBytes: 131072,
      maxSnapshotBytes: 10485760, maxMemoryEntries: 500, maxConcurrentExec: 8,
      respectGitignore: true, allowSensitiveReads: false,
    };
    const session = new Session(config, jail, gitignore);
    // Auto-load persisted state
    await Promise.all([
      session.index.load(),
      session.memory.load(),
      session.tasks.load(),
    ]);
    log.info('session created', { root: jail.root });
    return session;
  }
}
