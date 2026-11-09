"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Plus, RefreshCw } from "lucide-react";
import { formatDateTime } from "@/lib/date-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ApiKeyMetadata {
  id: number | string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  username?: string;
}

export function ApiKeyManager({ all = false }: { all?: boolean }) {
  const [keys, setKeys] = useState<ApiKeyMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyMetadata | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const loadKeys = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/api-keys${all ? "?all=1" : ""}`, {
        cache: "no-store",
        signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "获取 API Key 列表失败");
      if (!Array.isArray(data.keys)) throw new Error("获取 API Key 列表失败");
      // Keep only metadata: the full secret must never enter the list state.
      setKeys(data.keys.map((key: ApiKeyMetadata) => ({
        id: key.id,
        name: key.name,
        key_prefix: key.key_prefix,
        created_at: key.created_at,
        last_used_at: key.last_used_at,
        expires_at: key.expires_at,
        revoked_at: key.revoked_at,
        username: key.username,
      })));
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : "网络错误，请重试");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [all]);

  useEffect(() => {
    const controller = new AbortController();
    void loadKeys(controller.signal);
    return () => controller.abort();
  }, [loadKeys]);

  const createKey = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    setCreateError(null);
    const expiresInDays = days.trim() ? Number(days) : undefined;
    if (!name.trim() || name.trim().length > 100) {
      setCreateError("请填写名称（1–100 个字符）");
      return;
    }
    if (expiresInDays !== undefined && (!Number.isSafeInteger(expiresInDays) || expiresInDays < 1)) {
      setCreateError("有效期必须为正整数天数，或留空表示永不过期");
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), expires_in_days: expiresInDays }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "创建 API Key 失败");
      if (typeof data.key !== "string" || !data.key) throw new Error("创建响应缺少 API Key，请刷新列表确认后重试");
      setCreatedKey(data.key);
      setCopied(false);
      setCopyError(null);
      setShowCreate(false);
      setName("");
      setDays("");
      void loadKeys();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "网络错误，请重试");
    } finally {
      setCreating(false);
    }
  };

  const copyKey = async () => {
    if (!createdKey) return;
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
    } catch {
      setCopyError("复制失败，请选中上方完整 API Key 手动复制");
    }
  };

  const revokeKey = async () => {
    if (!revokeTarget || revoking) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      const response = await fetch(`/api/api-keys/${encodeURIComponent(revokeTarget.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "吊销 API Key 失败");
      }
      setRevokeTarget(null);
      await loadKeys();
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : "网络错误，请重试");
    } finally {
      setRevoking(false);
    }
  };

  const unrevokedCount = keys.filter((key) => !key.revoked_at).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              {all ? "所有用户的 API Key" : "API Key"}
            </CardTitle>
            <CardDescription>
              {all ? "查看并吊销所有用户的 API Key，权限跟随所属账号当前角色。" : "供 Grok Bot 等 MCP 客户端使用，权限跟随您的账号当前角色。"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={loading || revoking} onClick={() => void loadKeys()}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />刷新
            </Button>
            {!all && (
              <Button size="sm" disabled={loading || !!error || unrevokedCount >= 10} onClick={() => {
                setCreateError(null);
                setShowCreate(true);
              }}>
                <Plus className="h-4 w-4 mr-2" />新建 API Key
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!all && <p className="text-sm text-muted-foreground">每个账号最多 10 个未吊销的 Key；过期的 Key 也需吊销后才会释放名额。请勿将 Key 公开或分享给不可信的客户端。</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}，请点击刷新重试。</p>}
        <Table>
          <TableHeader>
            <TableRow>
              {all && <TableHead>用户名</TableHead>}
              <TableHead>名称 / 前缀</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>最后使用</TableHead>
              <TableHead>到期时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={all ? 7 : 6} className="py-8 text-center text-muted-foreground">加载中...</TableCell></TableRow>
            ) : keys.length === 0 ? (
              <TableRow><TableCell colSpan={all ? 7 : 6} className="py-8 text-center text-muted-foreground">{error ? "列表加载失败" : "暂无 API Key"}</TableCell></TableRow>
            ) : keys.map((key) => {
              const expired = !!key.expires_at && new Date(key.expires_at).getTime() <= Date.now();
              return (
                <TableRow key={key.id}>
                  {all && <TableCell>{key.username || "-"}</TableCell>}
                  <TableCell>
                    <p className="font-medium break-all">{key.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">cjsk_{key.key_prefix}_…</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={key.revoked_at ? "secondary" : expired ? "destructive" : "default"}>
                      {key.revoked_at ? "已吊销" : expired ? "已过期" : "有效"}
                    </Badge>
                    {key.revoked_at && <p className="mt-1 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(key.revoked_at)}</p>}
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{formatDateTime(key.created_at)}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{key.last_used_at ? formatDateTime(key.last_used_at) : "尚未使用"}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{key.expires_at ? formatDateTime(key.expires_at) : "永不过期"}</TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" disabled={!!key.revoked_at || revoking} onClick={() => {
                      setRevokeError(null);
                      setRevokeTarget(key);
                    }}>吊销</Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={showCreate} onOpenChange={(open) => { if (!creating) setShowCreate(open); }}>
        <DialogContent showCloseButton={!creating}>
          <DialogHeader>
            <DialogTitle>新建 API Key</DialogTitle>
            <DialogDescription>Key 将拥有您账号当前角色的权限。完整 Key 仅在创建后显示一次。</DialogDescription>
          </DialogHeader>
          <form onSubmit={createKey} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-key-name">名称</Label>
              <Input id="api-key-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required disabled={creating} placeholder="例如：Grok Bot" autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key-days">有效期（天，可选）</Label>
              <Input id="api-key-days" type="number" min={1} step={1} value={days} onChange={(e) => setDays(e.target.value)} disabled={creating} placeholder="留空表示永不过期" />
            </div>
            {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={creating} onClick={() => setShowCreate(false)}>取消</Button>
              <Button type="submit" disabled={creating}>{creating ? "创建中..." : "创建"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createdKey !== null} onOpenChange={(open) => {
        if (!open) { setCreatedKey(null); setCopied(false); setCopyError(null); }
      }}>
        <DialogContent showCloseButton={false} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>API Key 已创建</DialogTitle>
            <DialogDescription>完整 Key 只显示一次。请立即复制并妥善保存，关闭后无法再次查看。不要公开或发送给不可信的人。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="created-api-key">完整 API Key</Label>
            <Input id="created-api-key" readOnly value={createdKey || ""} className="font-mono text-xs" onFocus={(event) => event.target.select()} autoComplete="off" />
            {copyError && <p role="alert" className="text-sm text-destructive">{copyError}</p>}
            <p aria-live="polite" className="text-sm text-muted-foreground">{copied ? "已复制，请保存到安全的位置。" : "关闭前请确认已保存完整 Key。"}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => void copyKey()}>{copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}{copied ? "再次复制" : "复制 Key"}</Button>
            <Button onClick={() => { setCreatedKey(null); setCopied(false); setCopyError(null); }}>我已保存，关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revokeTarget !== null} onOpenChange={(open) => { if (!open && !revoking) setRevokeTarget(null); }}>
        <DialogContent showCloseButton={!revoking}>
          <DialogHeader>
            <DialogTitle>确认吊销 API Key？</DialogTitle>
            <DialogDescription>
              将吊销 {all && revokeTarget?.username ? `${revokeTarget.username} 的 ` : ""}“{revokeTarget?.name}”（cjsk_{revokeTarget?.key_prefix}_…）。此操作无法恢复，使用该 Key 的客户端将立即失去访问权限。
            </DialogDescription>
          </DialogHeader>
          {revokeError && <p role="alert" className="text-sm text-destructive">{revokeError}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={revoking} onClick={() => setRevokeTarget(null)}>取消</Button>
            <Button variant="destructive" disabled={revoking} onClick={() => void revokeKey()}>{revoking ? "吊销中..." : "确认吊销"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
