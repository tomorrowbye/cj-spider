import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getDb, type Database } from "@/lib/db";
import type { Kysely } from "kysely";
import { generateToken } from "./jwt";
import { resolveSession } from "./auth-session";
export { generateToken, verifyToken } from "./jwt";
export type { JwtPayload } from "./jwt";

const COOKIE_NAME = "site_auth_token";
const userColumns = ["id", "username", "role", "is_active", "created_at", "updated_at", "last_login_at"] as const;

export interface SiteUser {
  id: number;
  username: string;
  role: "admin" | "user";
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

type UserRow = Omit<SiteUser, "created_at" | "updated_at" | "last_login_at"> & {
  created_at: string | Date;
  updated_at: string | Date;
  last_login_at: string | Date | null;
};
function toSiteUser(row: UserRow): SiteUser {
  const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value;
  return { ...row, created_at: iso(row.created_at), updated_at: iso(row.updated_at), last_login_at: row.last_login_at === null ? null : iso(row.last_login_at) };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function getCurrentUser(): Promise<SiteUser | null> {
  const cookieStore = await cookies();
  return resolveSession(cookieStore.get(COOKIE_NAME)?.value, async (id) => {
    const user = await getDb().selectFrom("site_users").select(userColumns).where("id", "=", id).executeTakeFirst();
    return user ? toSiteUser(user) : null;
  });
}

export async function loginUser(username: string, password: string): Promise<{ success: boolean; user?: SiteUser; token?: string; error?: string }> {
  const db = getDb();
  const user = await db.selectFrom("site_users").selectAll().where("username", "=", username).where("is_active", "=", true).executeTakeFirst();
  if (!user || !(await verifyPassword(password, user.password_hash))) return { success: false, error: "用户名或密码错误" };
  const lastLogin = new Date().toISOString();
  await db.updateTable("site_users").set({ last_login_at: lastLogin }).where("id", "=", user.id).execute();
  const siteUser = toSiteUser({ id: user.id, username: user.username, role: user.role, is_active: user.is_active,
    created_at: user.created_at, updated_at: user.updated_at, last_login_at: lastLogin });
  return { success: true, user: siteUser, token: generateToken(siteUser) };
}

export async function createUserValidated(input: { username?: unknown; password?: unknown; role?: unknown }, db?: Kysely<Database>) {
  const { username, password, role = "user" } = input;
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) return { success: false, error: "用户名和密码不能为空" };
  if (username.length < 3 || username.length > 50) return { success: false, error: "用户名长度应在3-50个字符之间" };
  if (password.length < 4) return { success: false, error: "密码长度至少4个字符" };
  if (role !== "admin" && role !== "user") return { success: false, error: "角色无效" };
  return createUser(username, password, role, db);
}

export async function createUser(username: string, password: string, role: "admin" | "user" = "user", db?: Kysely<Database>): Promise<{ success: boolean; user?: SiteUser; error?: string }> {
  if (role !== "admin" && role !== "user") return { success: false, error: "角色无效" };
  const passwordHash = await hashPassword(password);
  try {
    const user = await (db ?? getDb()).transaction().execute(async (trx) => {
      const row = await trx.insertInto("site_users").values({ username, password_hash: passwordHash, role }).returning(userColumns).executeTakeFirstOrThrow();
      await trx.insertInto("auth_identities").values({ user_id: row.id, provider: "local", provider_subject: username }).execute();
      return toSiteUser(row);
    });
    return { success: true, user };
  } catch (error) {
    return { success: false, error: (error as { code?: string }).code === "23505" ? "用户名已存在" : "创建用户失败" };
  }
}

export async function updateUserPassword(userId: number, newPassword: string): Promise<{ success: boolean; error?: string }> {
  try {
    await getDb().updateTable("site_users").set({ password_hash: await hashPassword(newPassword), updated_at: new Date().toISOString() }).where("id", "=", userId).execute();
    return { success: true };
  } catch {
    return { success: false, error: "更新密码失败" };
  }
}

export async function getUserList(): Promise<SiteUser[]> {
  return (await getDb().selectFrom("site_users").select(userColumns).orderBy("created_at", "asc").execute()).map(toSiteUser);
}

export async function updateUserStatus(userId: number, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await getDb().updateTable("site_users").set({ is_active: isActive, updated_at: new Date().toISOString() }).where("id", "=", userId).execute();
    return { success: true };
  } catch {
    return { success: false, error: "更新用户状态失败" };
  }
}

export async function deleteUser(userId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getDb().selectFrom("site_users").select("username").where("id", "=", userId).executeTakeFirst();
    if (user?.username === "admin") return { success: false, error: "不能删除管理员账号" };
    await getDb().deleteFrom("site_users").where("id", "=", userId).execute();
    return { success: true };
  } catch {
    return { success: false, error: "删除用户失败" };
  }
}

export function getCookieName(): string { return COOKIE_NAME; }
