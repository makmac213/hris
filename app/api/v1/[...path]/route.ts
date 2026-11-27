// Every /api/v1 request goes through one pipeline: lib/server/http.ts. Routes are in lib/server/routes.ts.
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (req: Request) => handle(req);
export const POST = (req: Request) => handle(req);
export const PATCH = (req: Request) => handle(req);
export const PUT = (req: Request) => handle(req);
export const DELETE = (req: Request) => handle(req);
