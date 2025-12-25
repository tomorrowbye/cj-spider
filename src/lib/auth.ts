import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getSupabaseClient } from "./supabase";

// JWT 密钥，生产环境应该使用环境变量
const JWT_SECRET = process.env.JWT_SECRET || "cj-spider-jwt-secret-key-2024";
const JWT_EXPIRES_IN = "7d";
const COOKIE_NAME = "site_auth_token";

export interface SiteUser {
  id: number;
  username: string;
  role: "admin" | "user";
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
  iat?: number;
  exp?: number;
}

/**
 * 生成密码哈希
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * 验证密码
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * 生成 JWT Token
 */
export function generateToken(user: SiteUser): string {
  const payload: JwtPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * 验证 JWT Token
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * 从请求中获取当前用户
 */
export async function getCurrentUser(): Promise<SiteUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    if (!token) {
      return null;
    }

    const payload = verifyToken(token);
    if (!payload) {
      return null;
    }

    // 从数据库获取最新用户信息
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("site_users")
      .select("id, username, role, is_active, created_at, updated_at, last_login_at")
      .eq("id", payload.userId)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return null;
    }

    return data as SiteUser;
  } catch {
    return null;
  }
}

/**
 * 用户登录
 */
export async function loginUser(
  username: string,
  password: string
): Promise<{ success: boolean; user?: SiteUser; token?: string; error?: string }> {
  const supabase = getSupabaseClient();

  // 查找用户
  const { data: user, error } = await supabase
    .from("site_users")
    .select("*")
    .eq("username", username)
    .eq("is_active", true)
    .single();

  if (error || !user) {
    return { success: false, error: "用户名或密码错误" };
  }

  // 验证密码
  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    return { success: false, error: "用户名或密码错误" };
  }

  // 更新最后登录时间
  await supabase
    .from("site_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", user.id);

  // 生成 token
  const siteUser: SiteUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    is_active: user.is_active,
    created_at: user.created_at,
    updated_at: user.updated_at,
    last_login_at: new Date().toISOString(),
  };

  const token = generateToken(siteUser);

  return { success: true, user: siteUser, token };
}

/**
 * 创建新用户
 */
export async function createUser(
  username: string,
  password: string,
  role: "admin" | "user" = "user"
): Promise<{ success: boolean; user?: SiteUser; error?: string }> {
  const supabase = getSupabaseClient();

  // 检查用户名是否已存在
  const { data: existing } = await supabase
    .from("site_users")
    .select("id")
    .eq("username", username)
    .single();

  if (existing) {
    return { success: false, error: "用户名已存在" };
  }

  // 哈希密码
  const passwordHash = await hashPassword(password);

  // 创建用户
  const { data, error } = await supabase
    .from("site_users")
    .insert({
      username,
      password_hash: passwordHash,
      role,
    })
    .select("id, username, role, is_active, created_at, updated_at, last_login_at")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message || "创建用户失败" };
  }

  return { success: true, user: data as SiteUser };
}

/**
 * 更新用户密码
 */
export async function updateUserPassword(
  userId: number,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();

  const passwordHash = await hashPassword(newPassword);

  const { error } = await supabase
    .from("site_users")
    .update({
      password_hash: passwordHash,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * 获取所有用户列表
 */
export async function getUserList(): Promise<SiteUser[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("site_users")
    .select("id, username, role, is_active, created_at, updated_at, last_login_at")
    .order("created_at", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data as SiteUser[];
}

/**
 * 更新用户状态
 */
export async function updateUserStatus(
  userId: number,
  isActive: boolean
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from("site_users")
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * 删除用户
 */
export async function deleteUser(
  userId: number
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();

  // 不允许删除 admin 用户
  const { data: user } = await supabase
    .from("site_users")
    .select("username")
    .eq("id", userId)
    .single();

  if (user?.username === "admin") {
    return { success: false, error: "不能删除管理员账号" };
  }

  const { error } = await supabase
    .from("site_users")
    .delete()
    .eq("id", userId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * 获取 Cookie 名称
 */
export function getCookieName(): string {
  return COOKIE_NAME;
}
