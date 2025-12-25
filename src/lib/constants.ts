// 安徽财经网相关常量
export const CJ_BASE_URL = 'https://www.ahcaijing.com';

export const CJ_URLS = {
  // 验证码接口
  CAPTCHA: `${CJ_BASE_URL}/api.php?op=checkcode&code_len=5&font_size=14&width=120&height=26&font_color=&background=`,
  // 登录接口
  LOGIN: `${CJ_BASE_URL}/index.php?m=member&c=index&a=login`,
  // 会员发布页（用于检测登录状态）
  MEMBER_PAGE: `${CJ_BASE_URL}/index.php?m=member&c=content&a=published`,
};
