const fs = require("fs");
const cp = require("child_process");
const util = require("util");

const execAsync = util.promisify(cp.exec);
const basePath = `${__dirname}/..`;

const updateDeps = async () => {
  const pkgData = JSON.parse(
    fs.readFileSync(`${basePath}/package.json`, "utf8"),
  );

  if (pkgData.dependencies) {
    await processPkgSet(pkgData.dependencies);
  }

  if (pkgData.devDependencies) {
    await processPkgSet(pkgData.devDependencies, true);
  }

  return;
};

const processPkgSet = async (pkgs, dev = false) => {
  let names = Object.keys(pkgs);

  for (pkgName of names) {
    await updatePackage(`${pkgName}@latest`, basePath, dev);
  }
};

const exec = async (cmd, cwd) => {
  const { stdout, stderr } = await execAsync(cmd, { cwd: cwd });

  console.log(`Command output: ${stdout}`);
  if (stderr) {
    console.error(`Command execution error: ${stderr}`);
  }
};

const updatePackage = async (pkgName, cwd, dev = false) => {
  let cmd = ["npm", "i"];

  if (dev) {
    cmd.push("--save-dev");
  } else {
    cmd.push("--save");
  }

  cmd.push(pkgName);

  const cmdStr = cmd.join(" ");
  console.log(cmdStr);

  await exec(cmdStr, cwd);
};

updateDeps();
