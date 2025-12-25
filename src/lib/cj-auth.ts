import * as cheerio from 'cheerio';
import { CJ_URLS } from './constants';
import { encodeGB2312, decodeGBK } from './encoding';

export interface LoginParams {
  username: string;
  password: string;
  code: string;
  cookie: string;
}

export interface CaptchaResult {
  imageBuffer: Buffer;
  cookies: string[];
}

export interface LoginResult {
  success: boolean;
  cookies?: string[];
  error?: string;
}

/**
 * 获取验证码图片
 */
export async function getCaptcha(): Promise<CaptchaResult> {
  const url = `${CJ_URLS.CAPTCHA}&${Math.random()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  const cookies = response.headers.getSetCookie();
  const arrayBuffer = await response.arrayBuffer();
  const imageBuffer = Buffer.from(arrayBuffer);

  return {
    imageBuffer,
    cookies,
  };
}

/**
 * 执行登录
 */
export async function login(params: LoginParams): Promise<LoginResult> {
  const { username, password, code, cookie } = params;

  // 用户名需要 GB2312 编码
  const encodedUsername = encodeGB2312(username);

  // 构建表单数据
  const formData = `forward=&username=${encodedUsername}&password=${encodeURIComponent(password)}&code=${encodeURIComponent(code)}&dosubmit=`;

  try {
    const response = await fetch(CJ_URLS.LOGIN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: formData,
      redirect: 'manual',
    });

    const cookies = response.headers.getSetCookie();

    if (cookies && cookies.length > 0) {
      return {
        success: true,
        cookies,
      };
    }

    return {
      success: false,
      error: '登录失败，请检查用户名、密码或验证码',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '登录请求失败',
    };
  }
}

/**
 * 检查登录状态是否有效
 */
export async function checkLoginStatus(cookie: string): Promise<boolean> {
  try {
    const response = await fetch(CJ_URLS.MEMBER_PAGE, {
      method: 'GET',
      headers: {
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const arrayBuffer = await response.arrayBuffer();
    const html = decodeGBK(arrayBuffer);

    // 使用 cheerio 解析页面
    const $ = cheerio.load(html);
    const title = $('title').text();

    // 如果标题是 "提示信息"，说明未登录或会话失效
    return title !== '提示信息';
  } catch {
    return false;
  }
}
