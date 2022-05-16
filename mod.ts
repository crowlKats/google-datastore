// Copyright 2022 Kitson P. Kelly. All rights reserved. MIT License

/** APIs for using [Google Datastore](https://cloud.google.com/datastore) from
 * Deno.
 *
 * Google Datastore is Firestore in Datastore more under the hood these days,
 * but has a more concise API and lacks the complex rule system that Firestore
 * running in its native mode provides.
 *
 * @module
 */

import * as base64 from "https://deno.land/std@0.139.0/encoding/base64.ts";
import type * as types from "./types.d.ts";
import { createOAuth2Token, type OAuth2Token } from "./auth.ts";

export interface DatastoreInit {
  client_email: string;
  private_key: string;
  private_key_id: string;
  project_id: string;
}

export interface DatastoreErrorOptions extends ErrorOptions {
  status?: number;
  statusInfo?: unknown;
  statusText?: string;
}

export class DatastoreError extends Error {
  #status?: number;
  #statusInfo?: unknown;
  #statusText?: string;

  /** If the error was created as a result of a REST request, the status code
   * will be reflected here.
   */
  get status(): number | undefined {
    return this.#status;
  }

  /** If the error was created as a result of a REST request, the body of the
   * response will be set here. */
  get statusInfo(): unknown {
    return this.#statusInfo;
  }

  /** If the error was created as a result of a REST request, the status
   * text will be reflected here. */
  get statusText(): string | undefined {
    return this.#statusText;
  }

  constructor(message?: string, options: DatastoreErrorOptions = {}) {
    super(message, options);
    this.#status = options.status;
    this.#statusText = options.statusText;
    this.#statusInfo = options.statusInfo;
  }
}

class Auth {
  init: DatastoreInit;
  token?: OAuth2Token;

  constructor(init: DatastoreInit) {
    this.init = init;
  }

  async setToken(): Promise<OAuth2Token> {
    try {
      this.token = await createOAuth2Token(this.init, Datastore.SCOPES);
      return this.token;
    } catch (cause) {
      throw new DatastoreError(
        `Error setting token: ${
          cause instanceof Error ? cause.message : "Unknown"
        }`,
        { cause },
      );
    }
  }
}

interface ListOptions {
  filter?: string;
  /** The maximum number of items to return. If zero, then all results will be returned. */
  pageSize?: number;
  /** The next_page_token value returned from a previous List request, if any. */
  pageToken?: string;
}

function getRequestHeaders(token: OAuth2Token): Headers {
  return new Headers({
    "accept": "application/json",
    "authorization": token.toString(),
    "content-type": "application/json",
  });
}

// deno-lint-ignore ban-types
function optionsToQueryString<O extends object>(options?: O): string {
  return options
    ? `?${new URLSearchParams(Object.entries(options)).toString()}`
    : "";
}

class DatastoreIndexes {
  #auth: Auth;

  constructor(auth: Auth) {
    this.#auth = auth;
  }

  /** Creates the specified index.
   *
   * A newly created index's initial state is `CREATING`. On completion of the
   * returned google.longrunning.Operation, the state will be `READY`.
   *
   * If the index already exists, the call will return an `ALREADY_EXISTS`
   * status. During index creation, the process could result in an error, in
   * which case the index will move to the `ERROR` state. The process can be
   * recovered by fixing the data that caused the error, removing the index with
   * delete, then re-creating the index with create.
   *
   * Indexes with a single property cannot be created. */
  async create(
    index: types.GoogleDatastoreAdminV1Index,
  ): Promise<
    types.GoogleLongrunningOperation<types.GoogleDatastoreAdminV1IndexOutput>
  > {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}/indexes`,
      {
        method: "POST",
        body: JSON.stringify(index),
        headers: getRequestHeaders(token),
      },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Indexes.create error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
    return res.json();
  }

  /** Deletes an existing index.
   *
   * An index can only be deleted if it is in a `READY` or `ERROR` state. On
   * successful execution of the request, the index will be in a `DELETING`
   * state. And on completion of the returned google.longrunning.Operation, the
   * index will be removed. During index deletion, the process could result in
   * an error, in which case the index will move to the `ERROR` state. The
   * process can be recovered by fixing the data that caused the error, followed
   * by calling delete again. */
  async delete(
    indexId: string | { indexId: string },
  ): Promise<
    types.GoogleLongrunningOperation<types.GoogleDatastoreAdminV1IndexOutput>
  > {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const id = typeof indexId === "string" ? indexId : indexId.indexId;
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}/indexes/${id}`,
      { method: "DELETE", headers: getRequestHeaders(token) },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Indexes.delete error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
    return res.json();
  }

  /** Gets an index. */
  async get(
    indexId: string | { indexId: string },
  ): Promise<types.GoogleDatastoreAdminV1IndexOutput> {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const id = typeof indexId === "string" ? indexId : indexId.indexId;
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}/indexes/${id}`,
      { method: "GET", headers: getRequestHeaders(token) },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Indexes.get error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
    return res.json();
  }

  /** Lists the indexes that match the specified filters.
   *
   * Datastore uses an eventually consistent query to fetch the list of indexes
   * and may occasionally return stale results. */
  async list(
    options?: ListOptions,
  ): Promise<types.GoogleDatastoreAdminV1ListIndexesResponse> {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}/indexes${
        optionsToQueryString(options)
      }`,
      { method: "GET", headers: getRequestHeaders(token) },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Indexes.list error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
    return res.json();
  }
}

class DatastoreOperations {
  #auth: Auth;

  constructor(auth: Auth) {
    this.#auth = auth;
  }

  /** Starts asynchronous cancellation on a long-running operation.
   *
   * The server makes a best effort to cancel the operation, but success is not
   * guaranteed. If the server doesn't support this method, it returns
   * `google.rpc.Code.UNIMPLEMENTED`.
   *
   * Clients can use Operations.GetOperation or other methods to check whether
   * the cancellation succeeded or whether the operation completed despite
   * cancellation. On successful cancellation, the operation is not deleted;
   * instead, it becomes an operation with an Operation.error value with a
   * google.rpc.Status.code of 1, corresponding to `Code.CANCELLED`. */
  async cancel(name: string | { name: string }): Promise<void> {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const operationsId = typeof name === "string" ? name : name.name;
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}/operations/${operationsId}:cancel`,
      { method: "POST", headers: getRequestHeaders(token) },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Operations.cancel error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
  }

  /** Deletes a long-running operation.
   *
   * This method indicates that the client is no longer interested in the
   * operation result. It does not cancel the operation.
   *
   * If the server doesn't support this method, it returns
   * `google.rpc.Code.UNIMPLEMENTED`. */
  async delete(name: string | { name: string }): Promise<void> {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const operationsId = typeof name === "string" ? name : name.name;
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}/operations/${operationsId}`,
      { method: "DELETE", headers: getRequestHeaders(token) },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Operations.cancel error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
  }

  /** Gets the latest state of a long-running operation.
   *
   * Clients can use this method to poll the operation result at intervals as
   * recommended by the API service. */
  async get(
    name: string | { name: string },
  ): Promise<
    types.GoogleLongrunningOperation<types.GoogleDatastoreAdminV1IndexOutput>
  > {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const operationsId = typeof name === "string" ? name : name.name;
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}/operations/${operationsId}`,
      { method: "GET", headers: getRequestHeaders(token) },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Operations.cancel error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
    return res.json();
  }

  /** Lists operations that match the specified filter in the request. */
  async list(
    options?: ListOptions,
  ): Promise<types.GoogleLongrunningListOperationsResponse> {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}/operations${
        optionsToQueryString(options)
      }`,
      { method: "GET", headers: getRequestHeaders(token) },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Indexes.list error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
    return res.json();
  }
}

/** An interface to [Google Datastore](https://cloud.google.com/datastore).
 *
 * ### Example
 *
 * ```ts
 * import { Datastore } from "https://deno.land/x/google_datastore/mod.ts";
 * import keys from "./service-account.json" assert { type: "json" };
 *
 * const datastore = new Datastore(keys);
 *
 * const result = await datastore.query({ kind: "book" });
 * ```
 */
export class Datastore {
  #auth: Auth;
  #indexes: DatastoreIndexes;
  #operations: DatastoreOperations;

  /** APIs related to creating and managing indexes. */
  get indexes(): DatastoreIndexes {
    return this.#indexes;
  }

  /** APIs related to managing operations (long running processes). */
  get operations(): DatastoreOperations {
    return this.#operations;
  }

  constructor(datastoreInit: DatastoreInit) {
    this.#auth = new Auth(datastoreInit);
    this.#indexes = new DatastoreIndexes(this.#auth);
    this.#operations = new DatastoreOperations(this.#auth);
  }

  /** Allocates IDs for the given keys, which is useful for referencing an
   * entity before it is inserted. */
  async allocateIds(...keys: types.Key[]): Promise<types.Key[]> {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}:allocateIds`,
      {
        method: "POST",
        body: JSON.stringify({ keys }),
        headers: getRequestHeaders(token),
      },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Allocate Ids error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
    return (await res.json()).keys;
  }

  /** Begins a new transaction. */
  async beginTransaction(
    transactionOptions: types.TransactionOptions = { readWrite: {} },
  ): Promise<string> {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}:beginTransaction`,
      {
        method: "POST",
        body: JSON.stringify({ transactionOptions }),
        headers: getRequestHeaders(token),
      },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Allocate Ids error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
    return (await res.json()).transaction;
  }

  /** Commits a transaction, optionally creating, deleting or modifying some
   * entities. */
  async commit(
    mutations: types.Mutation[],
    transactional = true,
    transaction?: string,
  ): Promise<types.CommitResponse> {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const body: types.CommitRequest = {
      mode: transactional ? "TRANSACTIONAL" : "NON_TRANSACTIONAL",
      mutations,
      transaction,
    };
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}:commit`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: getRequestHeaders(token),
      },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Commit error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
    return res.json();
  }

  /** Looks up entities by key. */
  async lookup(
    keys: types.Key[],
    readOptions?: types.ReadOptions,
  ): Promise<types.LookupResponse> {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const body: types.LookupRequest = readOptions
      ? { keys, readOptions }
      : { keys };
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}:lookup`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: getRequestHeaders(token),
      },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Lookup error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
    return res.json();
  }

  /** Prevents the supplied keys' IDs from being auto-allocated by Cloud
   * Datastore. */
  async reserveIds(keys: types.Key[], databaseId?: string): Promise<void> {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const body: types.ReserveIdsRequest = databaseId
      ? { databaseId, keys }
      : { keys };
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}:reserveIds`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: getRequestHeaders(token),
      },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`ReserveIds error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
  }

  /** Rolls back a transaction. */
  async rollback(transaction: string): Promise<void> {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}:rollback`,
      {
        method: "POST",
        body: JSON.stringify({ transaction }),
        headers: getRequestHeaders(token),
      },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Rollback error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
  }

  /** Queries for entities. */
  async runQuery(query: types.Query): Promise<types.RunQueryResponse> {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}:runQuery`,
      {
        method: "POST",
        body: JSON.stringify({ query }),
        headers: getRequestHeaders(token),
      },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Query error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
    return res.json();
  }

  /** Queries for entities. */
  async runGqlQuery(gqlQuery: types.GqlQuery): Promise<types.RunQueryResponse> {
    let token = this.#auth.token;
    if (!token || token.expired) {
      token = await this.#auth.setToken();
    }
    const res = await fetch(
      `${Datastore.API_ROOT}${this.#auth.init.project_id}:runQuery`,
      {
        method: "POST",
        body: JSON.stringify({ gqlQuery }),
        headers: getRequestHeaders(token),
      },
    );
    if (res.status !== 200) {
      throw new DatastoreError(`Query error: ${res.statusText}`, {
        status: res.status,
        statusText: res.statusText,
        statusInfo: await res.json(),
      });
    }
    return res.json();
  }

  /** The root of the API endpoint. Used when forming request URLs. */
  static readonly API_ROOT = "https://datastore.googleapis.com/v1/projects/";
  /** The scopes provided when obtaining an API token. */
  static readonly SCOPES = "https://www.googleapis.com/auth/datastore";
}

function isValueArray(value: types.Value): value is types.ValueArray {
  return "arrayValue" in value;
}

function isValueBlob(value: types.Value): value is types.ValueBlob {
  return "blobValue" in value;
}

function isValueBoolean(value: types.Value): value is types.ValueBoolean {
  return "booleanValue" in value;
}

function isValueDouble(value: types.Value): value is types.ValueDouble {
  return "doubleValue" in value;
}

function isValueEntity(value: types.Value): value is types.ValueEntity {
  return "entityValue" in value;
}

function isValueGeoPoint(value: types.Value): value is types.ValueGeoPoint {
  return "geoPointValue" in value;
}

function isValueInteger(value: types.Value): value is types.ValueInteger {
  return "integerValue" in value;
}

function isValueKey(value: types.Value): value is types.ValueKey {
  return "keyValue" in value;
}

function isValueNull(value: types.Value): value is types.ValueNull {
  return "nullValue" in value;
}

function isValueString(value: types.Value): value is types.ValueString {
  return "stringValue" in value;
}

function isValueTimestamp(value: types.Value): value is types.ValueTimestamp {
  return "timestampValue" in value;
}

function stringAsInteger(value: string): number | bigint {
  const num = parseInt(value, 10);
  return num > Number.MAX_SAFE_INTEGER ? BigInt(value) : num;
}

/** Convert a Datastore `Value` to a JavaScript value. */
export function datastoreValueToValue(value: types.Value): unknown {
  if (isValueArray(value)) {
    return value.arrayValue.values.map(datastoreValueToValue);
  }
  if (isValueBlob(value)) {
    return base64.decode(value.blobValue);
  }
  if (isValueBoolean(value)) {
    return value.booleanValue;
  }
  if (isValueDouble(value)) {
    return value.doubleValue;
  }
  if (isValueEntity(value)) {
    return entityToObject(value.entityValue);
  }
  if (isValueGeoPoint(value)) {
    return value.geoPointValue;
  }
  if (isValueInteger(value)) {
    return stringAsInteger(value.integerValue);
  }
  if (isValueKey(value)) {
    return value.keyValue;
  }
  if (isValueNull(value)) {
    return null;
  }
  if (isValueString(value)) {
    return value.stringValue;
  }
  if (isValueTimestamp(value)) {
    return new Date(value.timestampValue);
  }
}

const datastoreKey = Symbol.for("google.datastore.key");

interface EntityMetaData {
  [datastoreKey]: types.Key;
}

/** Convert a Datastore {@linkcode types.Entity Entity} to a JavaScript object,
 * which can then be serialized easily back into an `Entity`. */
export function entityToObject<O>(entity: types.Entity): O & EntityMetaData {
  // deno-lint-ignore no-explicit-any
  const o: any = {};
  for (const [key, value] of Object.entries(entity.properties)) {
    o[key] = datastoreValueToValue(value);
  }
  Object.defineProperty(o, datastoreKey, {
    value: entity.key,
    writable: false,
    enumerable: false,
    configurable: true,
  });
  return o as O & EntityMetaData;
}

function isKey(value: unknown): value is types.Key {
  return value !== null && typeof value === "object" && "path" in value &&
    // deno-lint-ignore no-explicit-any
    Array.isArray((value as any).path) &&
    // deno-lint-ignore no-explicit-any
    (value as any).path.length >= 1;
}

function isLatLng(value: unknown): value is types.LatLng {
  return value !== null && typeof value === "object" && "latitude" in value &&
    "longitude" in value;
}

// deno-lint-ignore no-explicit-any
function isSerializeable(value: unknown): value is { toJSON(): any } {
  return value !== null && typeof value === "object" && "toJSON" in value;
}

/** A symbol which can be used to provide a custom method to generate an
 * `Entity` serialization for an object.  When performing
 * {@linkcode objectToEntity}, this method will be used instead of built in
 * serialization of objects to entities.
 *
 * ### Example
 *
 * ```ts
 * import { toEntity } from "google_datastore.ts";
 *
 * class A {
 *   a = "value";
 *   id = "a";
 *
 *   [toEntity]() {
 *     return {
 *       key: { path: [ { id: this.id, kind: A.KIND } ] },
 *       properties: { a: { stringValue: this.a }},
 *     }
 *   }
 *
 *   static KIND = "A";
 * }
 * ```
 */
export const toEntity = Symbol.for("google.datastore.toEntity");

function hasToEntity<T>(value: T): value is T & { [toEntity](): types.Entity } {
  return value !== null && typeof value === "object" && toEntity in value;
}

function toValue(value: unknown): types.Value | undefined {
  switch (typeof value) {
    case "bigint":
      return { integerValue: value.toString(10) };
    case "boolean":
      return { booleanValue: value };
    case "number":
      if (Number.isNaN(value) || !Number.isFinite(value)) {
        return { nullValue: "NULL_VALUE" };
      }
      if (Number.isInteger(value)) {
        return { integerValue: value.toString(10) };
      }
      return { doubleValue: value };
    case "object":
      if (value === null) {
        return { nullValue: "NULL_VALUE" };
      }
      if (ArrayBuffer.isView(value)) {
        return { blobValue: base64.encode(value.buffer) };
      }
      if (value instanceof Blob) {
        throw TypeError(
          "Blob's cannot be serialized into Datastore values. Use an ArrayBuffer directly instead.",
        );
      }
      if (value instanceof ReadableStream) {
        throw TypeError(
          "ReadableStream's cannot be serialized into Datastore values.",
        );
      }
      if (value instanceof Date) {
        return { timestampValue: value.toISOString() };
      }
      if (Array.isArray(value)) {
        return {
          arrayValue: {
            values: value.map(toValue).filter((value) =>
              !!value
            ) as types.Value[],
          },
        };
      }
      if (isKey(value)) {
        return { keyValue: value };
      }
      if (isLatLng(value)) {
        return { geoPointValue: value };
      }
      if (isSerializeable(value)) {
        return toValue(value.toJSON());
      }
      return { entityValue: objectToEntity(value) };
    case "string":
      return { stringValue: value };
    case "function":
    case "symbol":
    case "undefined":
      return undefined;
  }
}

/** A function which converts most JavaScript objects to entities that can be
 * stored in Google Datastore. If the object as a {@linkcode toEntity} symbol
 * method, it will be used to serialize the entity. */
// deno-lint-ignore no-explicit-any
export function objectToEntity(obj: any): types.Entity {
  if (hasToEntity(obj)) {
    return obj.toEntity();
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new TypeError("Only objects can be converted to entities");
  }
  const properties: Record<string, types.Value> = Object.create(null);
  for (const [key, value] of Object.entries(obj)) {
    if (key.match(/^__.*__$/)) {
      throw new TypeError("Entity property keys cannot match __.*__.");
    }
    const propertyValue = toValue(value);
    if (propertyValue) {
      properties[key] = propertyValue;
    }
  }
  const key: types.Key | undefined = obj[datastoreKey];
  return key ? { key, properties } : { properties };
}

/** Assign a datastore `Key` to a JavaScript object. This key will then be set
 * in any resulting `Entity`. */
export function objectSetKey(obj: unknown, key: types.Key): void {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new TypeError("Only objects can have the datastore key set.");
  }
  Object.defineProperty(obj, datastoreKey, {
    value: key,
    writable: false,
    enumerable: false,
    configurable: true,
  });
}
