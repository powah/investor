import { apiFetch } from "@/lib/api";

export type RemoteRequestOptions = RequestInit & {
  emptyResponse?: boolean;
};

export type RemoteSystem = {
  request: <T>(path: string, options?: RemoteRequestOptions) => Promise<T>;
};

export const httpRemoteSystem: RemoteSystem = {
  request: apiFetch,
};
