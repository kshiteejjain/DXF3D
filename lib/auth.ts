export const AUTH_COOKIE_NAME = "dxf3d_auth";
export const AUTH_USERNAME = process.env.CAD_AUTH_USERNAME ?? "admin";
export const AUTH_PASSWORD = process.env.CAD_AUTH_PASSWORD ?? "DXF3D@2026";
export const AUTH_SESSION_VALUE = process.env.CAD_AUTH_SESSION ?? "dxf3d-local-session";

export function isValidCredentials(username: string, password: string) {
  return username === AUTH_USERNAME && password === AUTH_PASSWORD;
}
