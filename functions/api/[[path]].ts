import { forwardToConvex, type ConvexEnv } from "../_lib/convex";
export const onRequest: PagesFunction<ConvexEnv> = (context) =>
  forwardToConvex(context.request, context.env);
