const { spawnSync } = require('child_process');
const { readFileSync } = require('fs');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const checkVersions = () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
  const tauriConf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf-8'));
  const cargoToml = readFileSync('src-tauri/Cargo.toml', 'utf-8');
  const cargoMatch = cargoToml.match(/^version\\s*=\\s*\"([^\"]+)\"/m);
  const cargoVersion = cargoMatch ? cargoMatch[1] : null;

  const version = packageJson.version;
  const mismatch = [
    tauriConf.version !== version ? 'src-tauri/tauri.conf.json' : null,
    cargoVersion !== version ? 'src-tauri/Cargo.toml' : null,
  ].filter(Boolean);

  if (mismatch.length) {
    console.error(`Version mismatch with package.json (${version}): ${mismatch.join(', ')}`);
    console.error('Run: npm run sync-version');
    process.exit(1);
  }
};

const main = () => {
  const args = process.argv.slice(2);
  const withBuild = args.includes('--build');

  checkVersions();
  run(npmCmd, ['run', 'typecheck']);
  run('cargo', ['check'], {
    cwd: 'src-tauri',
    env: { ...process.env, RUSTFLAGS: '-Dwarnings' },
  });

  if (withBuild) {
    run(npmCmd, ['run', 'tauri', 'build']);
  }
};

main();
