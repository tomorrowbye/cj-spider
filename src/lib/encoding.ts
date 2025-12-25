import iconv from 'iconv-lite';

/**
 * 将字符串编码为 GB2312 格式的 URL 编码
 */
export function encodeGB2312(str: string): string {
  const buffer = iconv.encode(str, 'gb2312');
  let result = '';
  for (let i = 0; i < buffer.length; i++) {
    result += '%' + buffer[i].toString(16).toUpperCase().padStart(2, '0');
  }
  return result;
}

/**
 * 将 GBK 编码的 Buffer 解码为字符串
 */
export function decodeGBK(buffer: ArrayBuffer): string {
  return iconv.decode(Buffer.from(buffer), 'gbk');
}
