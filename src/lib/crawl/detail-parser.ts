import * as cheerio from 'cheerio';
import { decodeGBK } from '../encoding';
import { ArticleDetail } from './types';
import { AREA_KEYWORDS, DEFAULT_AREA, CRAWL_CONFIG } from './config';

// 作者提取正则 - 支持中英文括号
const AUTHOR_PATTERNS = [
  { content: /(\([^()]+\))/g, replace: /[()]/g },      // 英文括号
  { content: /(（[^（）]+）)/g, replace: /[（）]/g },  // 中文括号
];

/**
 * 请求详情页面
 */
export async function fetchDetailPage(url: string): Promise<string> {
  // 确保使用 HTTPS
  const secureUrl = url.replace('http://', 'https://');

  const response = await fetch(secureUrl, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  const arrayBuffer = await response.arrayBuffer();
  return decodeGBK(arrayBuffer);
}

/**
 * 从标题分析地区
 */
export function analyzeArea(title: string): string {
  for (const [area, keywords] of Object.entries(AREA_KEYWORDS)) {
    for (const keyword of keywords) {
      if (title.includes(keyword)) {
        return area;
      }
    }
  }
  return DEFAULT_AREA;
}

/**
 * 从正文提取作者
 */
export function extractAuthor(content: string): string {
  for (const pattern of AUTHOR_PATTERNS) {
    const matches = content.match(pattern.content);
    if (matches && matches.length > 0) {
      // 取最后一个括号内容作为作者
      const lastMatch = matches[matches.length - 1];
      return lastMatch.replace(pattern.replace, '').trim();
    }
  }
  return '';
}

/**
 * HTML 转纯文本
 */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  // 移除脚本和样式
  $('script, style').remove();
  // 获取文本并清理多余空白
  return $.text()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解析详情页面
 */
export function parseDetailPage(id: string, html: string): ArticleDetail {
  const $ = cheerio.load(html);

  // 标题
  const title = $('.article-hd').find('h1').text().trim();

  // 正文 HTML
  const content = $('#text_content').html() || '';

  // 纯文本内容
  const contentText = htmlToText(content);

  // 来源和编辑
  const sourceText = $('.source').text();
  const [sourcePart] = sourceText.split('编辑：');
  const source = sourcePart
    ?.replace('来源：', '')
    .replace(/&nbsp;/gi, '')
    .trim() || '';

  // 分类
  const topic = $('div.crumbs').find('a').last().text().trim();

  // 发布时间
  const createdTime = $('span.time').text().trim();

  // 作者 (从正文末尾括号提取)
  const author = extractAuthor(content);

  // 地区 (从标题分析)
  const area = analyzeArea(title);

  const result: ArticleDetail = {
    id,
    title,
    content,
    contentText,
    source,
    author,
    topic,
    area,
    createdTime,
  };

  // 可选保存原始 HTML
  if (CRAWL_CONFIG.SAVE_RAW_HTML) {
    result.rawHtml = html;
  }

  return result;
}

/**
 * 请求并解析详情页
 */
export async function getArticleDetail(id: string, url: string): Promise<ArticleDetail> {
  const html = await fetchDetailPage(url);
  return parseDetailPage(id, html);
}
