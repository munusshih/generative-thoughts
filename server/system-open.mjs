import { execFile } from "node:child_process";

export function systemOpenCommand(target, platform = process.platform) {
  if (platform === "darwin") {
    return { command: "open", args: [target] };
  }

  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", target] };
  }

  return { command: "xdg-open", args: [target] };
}

export function openSystemTarget(
  target,
  {
    disabled = false,
    description = "item",
    launch = execFile,
    logger = console,
    platform = process.platform,
  } = {},
) {
  if (disabled) return;

  const { command, args } = systemOpenCommand(target, platform);

  launch(command, args, (error) => {
    if (!error) return;
    logger.warn(`Could not open the ${description} automatically: ${error.message}`);
    logger.warn(`Open ${target} manually.`);
  });
}
