import 'server-only';
import type { Kysely } from 'kysely';
import { getDb, serializeRow, type Database } from './db';
import { parseDateTime } from './article-repository';

export interface NewsSearchParams {
  author?:string; region?:string; sourceName?:string; category?:string;
  startDate?:string; endDate?:string; status?:string; keyword?:string; title?:string;
  page?:number; pageSize?:number; orderBy?:string; order?:'asc'|'desc';
}
export interface NewsItem {
  id:number; source_id:string; title:string; author:string|null; source_name:string|null;
  region:string|null; category:string|null; publish_time:string|null; status:string; created_at:string;
}
export interface NewsListResult {data:NewsItem[];total:number;page:number;pageSize:number;totalPages:number}
const columns = ['id','source_id','title','author','source_name','region','category','publish_time','status','created_at'] as const;
function filteredQuery(params: NewsSearchParams, db: Kysely<Database>) {
  let query=db.selectFrom('news');
  if (params.author) query=query.where('author','ilike',`%${params.author}%`);
  if (params.title) query=query.where('title','ilike',`%${params.title}%`);
  if (params.region) query=query.where('region','=',params.region);
  if (params.sourceName) query=query.where('source_name','=',params.sourceName);
  if (params.category) query=query.where('category','=',params.category);
  if (params.status) query=query.where('status','=',params.status as 'pending'|'crawled'|'failed');
  if (params.startDate) query=query.where('publish_time','>=',parseDateTime(params.startDate) ?? params.startDate);
  if (params.endDate) query=query.where('publish_time','<=',parseDateTime(params.endDate) ?? params.endDate);
  if (params.keyword) query=query.where(eb=>eb.or([eb('title','ilike',`%${params.keyword}%`),eb('author','ilike',`%${params.keyword}%`)]));
  return query;
}
function sortColumn(value = 'source_id'): keyof Database['news'] {
  const allowed: (keyof Database['news'])[] = ['id','source_id','title','author','source_name','region','category','publish_time','status','created_at','updated_at','crawl_time','view_count','share_count'];
  if (!allowed.includes(value as keyof Database['news'])) throw new Error('Invalid news sort column');
  return value as keyof Database['news'];
}
export async function getNewsList(params: NewsSearchParams, db = getDb()): Promise<NewsListResult> {
  const {page=1,pageSize=20}=params;
  if (!Number.isInteger(page)||!Number.isInteger(pageSize)||page<1||pageSize<1) throw new Error('Invalid pagination');
  const query=filteredQuery(params,db);
  const {count}=await query.select(eb=>eb.fn.countAll().as('count')).executeTakeFirstOrThrow();
  const data=await query.select(columns).orderBy(sortColumn(params.orderBy),params.order==='asc'?'asc':'desc').limit(pageSize).offset((page-1)*pageSize).execute();
  return {data:serializeRow(data),total:Number(count),page,pageSize,totalPages:Math.ceil(Number(count)/pageSize)};
}
export async function getNewsForExport(params: Omit<NewsSearchParams,'page'|'pageSize'>, db = getDb()) {
  return serializeRow(await filteredQuery(params,db).select([...columns,'content_text']).orderBy(sortColumn(params.orderBy),params.order==='asc'?'asc':'desc').execute());
}
export async function getFilterOptions(db = getDb()): Promise<{authors:string[];regions:string[];sourceNames:string[];categories:string[]}> {
  const distinct = async (column:'author'|'region'|'source_name'|'category') => (await db.selectFrom('news').select(column).distinct().where(column,'is not',null).where(column,'!=','').execute()).map(r=>r[column]!).sort();
  const [authors,regions,sourceNames,categories]=await Promise.all([distinct('author'),distinct('region'),distinct('source_name'),distinct('category')]);
  return {authors,regions,sourceNames,categories};
}
