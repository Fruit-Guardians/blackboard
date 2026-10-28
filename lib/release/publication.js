import fs from 'node:fs';
import path from 'node:path';

// Keep the publication error as the thrown object, including its filesystem
// code. Cleanup failures add recovery details instead of hiding that cause.
function cleanupFailedStaging(staging, error, recursive) {
  try {
    fs.rmSync(staging, { recursive, force: true });
  } catch (cleanupError) {
    error.cleanupErrors = [{ path: staging, error: cleanupError }];
    error.message += `；清理临时路径 ${staging} 失败: ${cleanupError.message}`;
  }
}

/** Copy every published file before replacing an installed version. */
export function publishPackage({ source, files, dest, info }) {
  const versions = path.dirname(dest);
  const version = path.basename(dest);
  const staging = path.join(versions, `.${version}.staging-${process.pid}`);
  const retired = path.join(versions, `.${version}.replaced-${process.pid}`);
  // A previous failed rollback or cleanup may have left the only old copy here.
  // Never overwrite it, even if the destination is currently absent.
  if (fs.existsSync(retired)) {
    const error = new Error(`旧版本保留目录已存在: ${retired}；请先恢复或清理该目录后再安装 ${dest}`);
    error.recoveryPath = retired;
    throw error;
  }
  fs.mkdirSync(versions, { recursive: true });
  fs.rmSync(staging, { recursive: true, force: true });
  let movedOldVersion = false;
  try {
    for (const entry of ['package.json', ...files]) {
      const from = path.join(source, entry);
      if (!fs.existsSync(from)) throw new Error(`包文件缺失: ${entry}`);
      fs.cpSync(from, path.join(staging, entry), { recursive: true });
    }
    fs.writeFileSync(path.join(staging, '.release.json'), JSON.stringify(info, null, 2));
    if (fs.existsSync(dest)) {
      fs.renameSync(dest, retired);
      movedOldVersion = true;
    }
    fs.renameSync(staging, dest);
  } catch (error) {
    if (movedOldVersion) {
      try {
        fs.renameSync(retired, dest);
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
        error.recoveryPath = retired;
        error.message += `；旧版本保留在 ${retired}；恢复到 ${dest} 失败: ${rollbackError.message}`;
      }
    }
    cleanupFailedStaging(staging, error, true);
    throw error;
  }

  const warnings = [];
  if (movedOldVersion) {
    try {
      fs.rmSync(retired, { recursive: true, force: true });
    } catch (error) {
      // Publication already succeeded. Report leftover old bytes without
      // turning a complete, active replacement into a failed installation.
      warnings.push(`版本已安装，但清理旧版本目录 ${retired} 失败: ${error.message}`);
    }
  }
  return warnings;
}

/** Atomically publish a platform-appropriate current link. */
export function publishCurrentLink(link, dest) {
  const staging = `${link}.staging-${process.pid}`;
  fs.rmSync(staging, { force: true });
  try {
    if (process.platform === 'win32') fs.symlinkSync(dest, staging, 'junction');
    else fs.symlinkSync(path.relative(path.dirname(link), dest), staging);
    fs.renameSync(staging, link);
  } catch (error) {
    cleanupFailedStaging(staging, error, false);
    throw error;
  }
}
