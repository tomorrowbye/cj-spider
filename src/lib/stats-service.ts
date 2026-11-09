import 'server-only';
import { sql } from 'kysely';
import { getDb } from './db';
import { getNewsStats } from './article-repository';

export async function getOverview(db = getDb()) {
  const counts=await getNewsStats(db);
  const {rows}=await sql<{todayCount:number;weekCount:number}>`
    SELECT count(*) FILTER (WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'))::integer AS "todayCount",
    count(*) FILTER (WHERE created_at >= ((date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - extract(dow FROM now() AT TIME ZONE 'Asia/Shanghai')::integer * interval '1 day') AT TIME ZONE 'Asia/Shanghai'))::integer AS "weekCount"
    FROM news`.execute(db);
  const processed=counts.crawled+counts.failed;
  return {...counts,...rows[0],successRate:processed?Math.round(counts.crawled/processed*1000)/10:100};
}
export async function getDistribution(db = getDb()) {
  const group = async (column:'region'|'source_name'|'author', limit?:number) => {
    let query=db.selectFrom('news').select([`${column} as name`, eb=>eb.fn.countAll().as('count')]).where('status','=','crawled').where(column,'is not',null).where(column,'!=','').groupBy(column).orderBy('count','desc');
    if (limit) query=query.limit(limit);
    return (await query.execute()).map(r=>({name:r.name!,count:Number(r.count)}));
  };
  const [regions,sources,authors]=await Promise.all([group('region'),group('source_name',10),group('author',10)]);
  return {regions,sources,authors};
}
export async function getContentStats(db = getDb()) {
  const length=await sql<{range:string;count:number}>`SELECT CASE WHEN char_length(content_text)<500 THEN '0-500' WHEN char_length(content_text)<1000 THEN '500-1000' WHEN char_length(content_text)<2000 THEN '1000-2000' WHEN char_length(content_text)<5000 THEN '2000-5000' ELSE '5000+' END AS range, count(*)::integer AS count FROM news WHERE status='crawled' AND content_text IS NOT NULL GROUP BY 1 ORDER BY min(char_length(content_text))`.execute(db);
  const image=await sql<{withImages:number;withoutImages:number}>`SELECT count(*) FILTER (WHERE CASE WHEN jsonb_typeof(images)='array' THEN jsonb_array_length(images)>0 ELSE false END)::integer AS "withImages", count(*) FILTER (WHERE NOT (CASE WHEN jsonb_typeof(images)='array' THEN jsonb_array_length(images)>0 ELSE false END))::integer AS "withoutImages" FROM news WHERE status='crawled'`.execute(db);
  const tags=await sql<{tag:string;count:number}>`SELECT tag, count(*)::integer AS count FROM news CROSS JOIN LATERAL unnest(tags) AS tag WHERE status='crawled' GROUP BY tag ORDER BY count DESC, tag LIMIT 20`.execute(db);
  return {lengthDistribution:length.rows,...image.rows[0],topTags:tags.rows};
}
export async function getTrend(days: number, db = getDb()) {
  if (!Number.isInteger(days)||days<1||days>3650) throw new Error('Invalid trend range');
  const crawl=await sql<{date:string;count:number}>`WITH dates AS (SELECT generate_series((now() AT TIME ZONE 'Asia/Shanghai')::date - (${days}-1), (now() AT TIME ZONE 'Asia/Shanghai')::date, interval '1 day')::date AS day) SELECT to_char(d.day,'YYYY-MM-DD') AS date, count(n.id)::integer AS count FROM dates d LEFT JOIN news n ON (n.created_at AT TIME ZONE 'Asia/Shanghai')::date=d.day AND n.status='crawled' AND n.created_at >= now()-${days}*interval '1 day' GROUP BY d.day ORDER BY d.day`.execute(db);
  const publish=await sql<{month:string;count:number}>`SELECT to_char(publish_time AT TIME ZONE 'Asia/Shanghai','YYYY-MM') AS month, count(*)::integer AS count FROM news WHERE status='crawled' AND publish_time IS NOT NULL AND created_at >= now()-${days}*interval '1 day' GROUP BY 1 ORDER BY 1`.execute(db);
  return {crawlTrend:crawl.rows,publishTrend:publish.rows};
}
