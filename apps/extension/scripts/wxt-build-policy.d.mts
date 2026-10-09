export function extensionBuildArguments(input: string[], env?: Record<string, string | undefined>): {
  args: string[];
  legacyClerk: boolean;
};
