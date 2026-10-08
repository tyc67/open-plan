// The workspace boundary of the MCP server (roadmap C5): tools work on files inside one root folder only. The CLI
// does not use it; it accepts any path.
import { lstat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { backupFolder, canonicalPath, CliError } from './files.js';

export class Workspace {
  private constructor(readonly root: string) {}

  /** The workspace of a folder, by its canonical path. */
  static async open(folder: string): Promise<Workspace> {
    const root = await canonicalPath(folder, true);
    let info;
    try { info = await lstat(root); } catch { throw new CliError('USAGE', `The workspace root ${folder} cannot be read.`, { root: folder }); }
    if (!info.isDirectory()) throw new CliError('USAGE', `The workspace root ${folder} is not a folder.`, { root: folder });
    return new Workspace(root);
  }

  contains(path: string): boolean {
    const rel = relative(this.root, path);
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
  }

  private outside(given: string): never {
    throw new CliError('PATH_OUTSIDE_WORKSPACE', `${given} is outside the workspace ${this.root}. Use a path inside it.`, { path: given, root: this.root });
  }

  /**
   * The canonical path of a tool's `path`: relative to the root (not to the process folder), or absolute inside it.
   * A symlink is resolved, so one that points out of the root is refused. All later I/O uses the returned path.
   */
  async resolve(given: string, mustExist: boolean): Promise<string> {
    if (typeof given !== 'string' || !given || given.includes('\0')) throw new CliError('USAGE', 'A path must be a non-empty string.', { path: given });
    const absolute = isAbsolute(given) ? given : join(this.root, given);
    let path: string;
    // Resolved as a possibly new file first, so that a missing file outside is refused as outside, not reported missing.
    try { path = await canonicalPath(absolute, false); } catch (error) {
      if (!this.contains(resolve(absolute))) this.outside(given);
      throw error;
    }
    if (path === this.root || !this.contains(path)) this.outside(given);
    if (mustExist) {
      try { await lstat(path); } catch { throw new CliError('FILE_NOT_FOUND', `${given} does not exist in the workspace.`, { path: given }); }
    }
    return path;
  }

  /**
   * The check for the operations (`OpOptions.boundary`), on a canonical plan path: under the lock for a write, after
   * the read for a read. The backup folder next to the plan must not be a symlink.
   */
  readonly boundary = async (path: string): Promise<void> => {
    if (!this.contains(path) || path === this.root) this.outside(path);
    let info;
    try { info = await lstat(backupFolder(path)); } catch { return; }
    // A file there is not a link out: the backup then fails (BACKUP_FAILED), as in the CLI.
    if (info.isSymbolicLink()) throw new CliError('PATH_OUTSIDE_WORKSPACE', `The backup folder ${backupFolder(path)} is a symlink. Only a real folder inside the workspace is used.`, { path: backupFolder(path), root: this.root });
  };
}
