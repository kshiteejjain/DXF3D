export const AUTH_COOKIE_NAME = "dxf3d_auth";
export const AUTH_PASSWORD = process.env.CAD_AUTH_PASSWORD ?? "DXF3D@2026";
export const AUTH_SESSION_VALUE = process.env.CAD_AUTH_SESSION ?? "dxf3d-local-session";

export function isValidPassword(password: string) {
  return password === AUTH_PASSWORD;
}
