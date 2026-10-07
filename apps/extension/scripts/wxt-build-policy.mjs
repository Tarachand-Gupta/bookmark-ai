/** This migration source keeps Clerk builds available only for deliberate rollback. */
export function extensionBuildArguments(input) {
  const legacyClerk = input.includes("--legacy-clerk");
  const args = input.filter((argument) => argument !== "--legacy-clerk");
  if (!["build", "zip"].includes(args[0])) return { args, legacyClerk: false };
  if (args.some((argument) => ["--help", "-h", "--version", "-v"].includes(argument))) {
    return { args, legacyClerk: false };
  }
  if (legacyClerk) return { args, legacyClerk: true };

  const modes = [];
  for (let index = 1; index < args.length; index++) {
    const argument = args[index];
    if (argument === "-m" || argument === "--mode") modes.push(args[++index]);
    else if (argument.startsWith("--mode=")) modes.push(argument.slice(7));
    else if (argument.startsWith("-m=")) modes.push(argument.slice(3));
  }
  if (modes.length !== 1 || modes[0] !== "supabase-qa") {
    throw new Error(
      "This Supabase source requires a Supabase extension build. From the repo root use " +
      "corepack pnpm qa:supabase chrome build --hosted-production " +
      "(or firefox/safari). Ordinary .output builds use legacy Clerk authentication. " +
      "For deliberate Clerk rollback only, pass --legacy-clerk to wxt-run.mjs.",
    );
  }
  return { args, legacyClerk: false };
}
