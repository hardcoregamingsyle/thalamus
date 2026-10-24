/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import type * as authEmail from "../authEmail.js";
import type * as customAuth from "../customAuth.js";
import type * as customAuthHelpers from "../customAuthHelpers.js";
import type * as http from "../http.js";
import type * as nameless from "../nameless.js";
import type * as namelessHttp from "../namelessHttp.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  authEmail: typeof authEmail;
  customAuth: typeof customAuth;
  customAuthHelpers: typeof customAuthHelpers;
  http: typeof http;
  nameless: typeof nameless;
  namelessHttp: typeof namelessHttp;
}>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
