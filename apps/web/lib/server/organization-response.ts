import { NextResponse } from "next/server";
import { OrganizationError } from "@bookmark-ai/engine";
export function organizationErrorResponse(error: unknown): NextResponse {
  if (error instanceof OrganizationError)
    return NextResponse.json(
      { error: error.message, code: error.code, ...error.details },
      { status: error.status },
    );
  console.error(
    "Organization operation failed",
    error instanceof Error ? error.message : "unknown error",
  );
  return NextResponse.json(
    {
      error: "Could not confirm the operation. Check its result before retrying.",
      code: "operation-unknown",
    },
    { status: 503 },
  );
}
