import * as cheerio from 'cheerio';
import { CJ_URLS } from '../constants';
import { decodeGBK } from '../encoding';
import { ArticleListItem, ListPageResult } from './types';
import { VALID_ARTICLE_STATUS } from './config';

const LIST_PAGE_URL = `${CJ_URLS.MEMBER_PAGE}&page=`;

/**
 * 请求列表页面
 */
export async function fetchListPage(page: number, cookie: string): Promise<string> {
  const url = `${LIST_PAGE_URL}${page}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  const arrayBuffer = await response.arrayBuffer();
  return decodeGBK(arrayBuffer);
}

/**
 * 检查页面是否需要登录
 */
export function isLoginRequired(html: string): boolean {
  const $ = cheerio.load(html);
  const title = $('title').text();
  return title === '提示信息';
}

/**
 * 解析列表页面
 */
export function parseListPage(page: number, html: string): ListPageResult {
  const $ = cheerio.load(html);

  // 获取总条数
  const totalText = $('a.a1').first().text();
  const totalMatch = totalText.match(/(\d+)/);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;

  // 解析文章列表
  const articles: ArticleListItem[] = [];

  $('tr').each((_, row) => {
    const $row = $(row);
    const $tds = $row.children('td');

    if ($tds.length < 5) return; // 跳过表头或无效行

    const $centerTds = $tds.filter('[align="center"]');
    const $leftTd = $tds.filter('[align="left"]').first();

    if ($centerTds.length < 4) return;

    const id = $($centerTds[0]).text().trim();
    const $link = $leftTd.find('a');
    const link = $link.attr('href') || '';
    const title = $link.text().trim();
    const topic = $($centerTds[1]).text().trim();
    const createdTime = $($centerTds[2]).text().trim();
    const status = $($centerTds[3]).text().trim();

    // 只有有效的文章链接才添加
    if (id && link) {
      articles.push({
        id,
        link: link.startsWith('http') ? link : `https://www.ahcaijing.com${link}`,
        title,
        topic,
        createdTime,
        status,
      });
    }
  });

  return {
    page,
    total,
    articles,
  };
}

/**
 * 过滤有效文章 (状态为"通过")
 */
export function filterValidArticles(articles: ArticleListItem[]): ArticleListItem[] {
  return articles.filter(article => article.status === VALID_ARTICLE_STATUS);
}

/**
 * 请求并解析列表页
 */
export async function getListPage(page: number, cookie: string): Promise<ListPageResult | null> {
  const html = await fetchListPage(page, cookie);

  if (isLoginRequired(html)) {
    return null;
  }

  return parseListPage(page, html);
}
