/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as agentoverflow from "../agentoverflow.js";
import type * as agentoverflowAdmin from "../agentoverflowAdmin.js";
import type * as agentoverflowHttp from "../agentoverflowHttp.js";
import type * as agentoverflowMcp from "../agentoverflowMcp.js";
import type * as agentoverflowPublic from "../agentoverflowPublic.js";
import type * as analytics from "../analytics.js";
import type * as crons from "../crons.js";
import type * as customAuth from "../customAuth.js";
import type * as customAuthHelpers from "../customAuthHelpers.js";
import type * as http from "../http.js";
import type * as lib_agentCore from "../lib/agentCore.js";
import type * as lib_agentOutputParser from "../lib/agentOutputParser.js";
import type * as lib_agentPrompts from "../lib/agentPrompts.js";
import type * as lib_aiAttachments from "../lib/aiAttachments.js";
import type * as lib_deadlySignalsClient from "../lib/deadlySignalsClient.js";
import type * as lib_dokobotClient from "../lib/dokobotClient.js";
import type * as lib_huggingFaceClient from "../lib/huggingFaceClient.js";
import type * as lib_kimiClient from "../lib/kimiClient.js";
import type * as lib_modalClient from "../lib/modalClient.js";
import type * as lib_modePrompts from "../lib/modePrompts.js";
import type * as lib_modelscopeClient from "../lib/modelscopeClient.js";
import type * as lib_ollamaClient from "../lib/ollamaClient.js";
import type * as lib_openrouterClient from "../lib/openrouterClient.js";
import type * as lib_orcaRouterClient from "../lib/orcaRouterClient.js";
import type * as lib_pollinationsClient from "../lib/pollinationsClient.js";
import type * as lib_providerCooldowns from "../lib/providerCooldowns.js";
import type * as lib_relayProtocol from "../lib/relayProtocol.js";
import type * as lib_taskTypes from "../lib/taskTypes.js";
import type * as lib_zenClient from "../lib/zenClient.js";
import type * as providerLog from "../providerLog.js";
import type * as relay from "../relay.js";
import type * as userApiKeys from "../userApiKeys.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  agentoverflow: typeof agentoverflow;
  agentoverflowAdmin: typeof agentoverflowAdmin;
  agentoverflowHttp: typeof agentoverflowHttp;
  agentoverflowMcp: typeof agentoverflowMcp;
  agentoverflowPublic: typeof agentoverflowPublic;
  analytics: typeof analytics;
  crons: typeof crons;
  customAuth: typeof customAuth;
  customAuthHelpers: typeof customAuthHelpers;
  http: typeof http;
  "lib/agentCore": typeof lib_agentCore;
  "lib/agentOutputParser": typeof lib_agentOutputParser;
  "lib/agentPrompts": typeof lib_agentPrompts;
  "lib/aiAttachments": typeof lib_aiAttachments;
  "lib/deadlySignalsClient": typeof lib_deadlySignalsClient;
  "lib/dokobotClient": typeof lib_dokobotClient;
  "lib/huggingFaceClient": typeof lib_huggingFaceClient;
  "lib/kimiClient": typeof lib_kimiClient;
  "lib/modalClient": typeof lib_modalClient;
  "lib/modePrompts": typeof lib_modePrompts;
  "lib/modelscopeClient": typeof lib_modelscopeClient;
  "lib/ollamaClient": typeof lib_ollamaClient;
  "lib/openrouterClient": typeof lib_openrouterClient;
  "lib/orcaRouterClient": typeof lib_orcaRouterClient;
  "lib/pollinationsClient": typeof lib_pollinationsClient;
  "lib/providerCooldowns": typeof lib_providerCooldowns;
  "lib/relayProtocol": typeof lib_relayProtocol;
  "lib/taskTypes": typeof lib_taskTypes;
  "lib/zenClient": typeof lib_zenClient;
  providerLog: typeof providerLog;
  relay: typeof relay;
  userApiKeys: typeof userApiKeys;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
