"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/date-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UserPlus,
  Trash2,
  Key,
  Shield,
  ShieldCheck,
  UserX,
  UserCheck,
} from "lucide-react";

interface User {
  id: number;
  username: string;
  role: "admin" | "user";
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<{
    id: number;
    role: string;
  } | null>(null);

  // 新建用户弹窗
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [creating, setCreating] = useState(false);

  // 修改密码弹窗
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newUserPassword, setNewUserPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const response = await fetch("/api/site-auth/me");
      const data = await response.json();

      if (!data.success) {
        router.push("/site-login");
        return false;
      }

      if (data.user.role !== "admin") {
        router.push("/");
        return false;
      }

      setCurrentUser(data.user);
      return true;
    } catch {
      router.push("/site-login");
      return false;
    }
  }, [router]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/users");
      const data = await response.json();

      if (data.success) {
        setUsers(data.data);
      }
    } catch (error) {
      console.error("获取用户列表失败:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCurrentUser().then((ok) => {
      if (ok) {
        fetchUsers();
      }
    });
  }, [fetchCurrentUser, fetchUsers]);

  const handleCreate = async () => {
    if (!newUsername || !newPassword) {
      alert("请填写用户名和密码");
      return;
    }

    setCreating(true);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setShowCreateModal(false);
        setNewUsername("");
        setNewPassword("");
        setNewRole("user");
        fetchUsers();
      } else {
        alert(data.error || "创建失败");
      }
    } catch {
      alert("创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (user: User) => {
    if (
      !confirm(
        `确定要${user.is_active ? "禁用" : "启用"}用户 "${user.username}" 吗？`,
      )
    ) {
      return;
    }

    try {
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          action: "updateStatus",
          value: !user.is_active,
        }),
      });

      const data = await response.json();

      if (data.success) {
        fetchUsers();
      } else {
        alert(data.error || "操作失败");
      }
    } catch {
      alert("操作失败");
    }
  };

  const handleUpdatePassword = async () => {
    if (!editingUser || !newUserPassword) {
      alert("请输入新密码");
      return;
    }

    setUpdatingPassword(true);
    try {
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editingUser.id,
          action: "updatePassword",
          value: newUserPassword,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setShowPasswordModal(false);
        setEditingUser(null);
        setNewUserPassword("");
        alert("密码修改成功");
      } else {
        alert(data.error || "修改失败");
      }
    } catch {
      alert("修改失败");
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`确定要删除用户 "${user.username}" 吗？此操作不可恢复！`)) {
      return;
    }

    try {
      const response = await fetch(`/api/users?id=${user.id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (data.success) {
        fetchUsers();
      } else {
        alert(data.error || "删除失败");
      }
    } catch {
      alert("删除失败");
    }
  };

  const formatDate = formatDateTime;

  const getRoleBadge = (role: string) => {
    if (role === "admin") {
      return (
        <Badge className="bg-purple-500 hover:bg-purple-600">
          <ShieldCheck className="w-3 h-3 mr-1" />
          管理员
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <Shield className="w-3 h-3 mr-1" />
        普通用户
      </Badge>
    );
  };

  const getStatusBadge = (isActive: boolean) => {
    if (isActive) {
      return <Badge className="bg-green-500 hover:bg-green-600">正常</Badge>;
    }
    return <Badge variant="destructive">已禁用</Badge>;
  };

  if (!currentUser) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Skeleton className="h-10 w-32 mb-8" />
        <Card>
          <CardContent className="p-8">
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">账号管理</h1>
        <p className="text-muted-foreground">管理系统用户账号和权限</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>用户列表</CardTitle>
              <CardDescription>管理系统用户账号</CardDescription>
            </div>
            <Button onClick={() => setShowCreateModal(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              新建用户
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>用户名</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>最后登录</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-8" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-muted-foreground"
                  >
                    暂无用户数据
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-mono">{user.id}</TableCell>
                    <TableCell className="font-medium">
                      {user.username}
                    </TableCell>
                    <TableCell>{getRoleBadge(user.role)}</TableCell>
                    <TableCell>{getStatusBadge(user.is_active)}</TableCell>
                    <TableCell className="text-sm">
                      {formatDate(user.created_at)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(user.last_login_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingUser(user);
                            setShowPasswordModal(true);
                          }}
                          title="修改密码"
                        >
                          <Key className="w-4 h-4" />
                        </Button>
                        {user.username !== "admin" && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleStatus(user)}
                              title={user.is_active ? "禁用" : "启用"}
                            >
                              {user.is_active ? (
                                <UserX className="w-4 h-4 text-yellow-600" />
                              ) : (
                                <UserCheck className="w-4 h-4 text-green-600" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(user)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 新建用户弹窗 */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建用户</DialogTitle>
            <DialogDescription>创建一个新的系统用户账号</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-username">用户名</Label>
              <Input
                id="new-username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="请输入用户名（3-50个字符）"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">密码</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="请输入密码（至少4个字符）"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-role">角色</Label>
              <Select
                value={newRole}
                onValueChange={(v) => setNewRole(v as "admin" | "user")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">普通用户</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 修改密码弹窗 */}
      <Dialog open={showPasswordModal} onOpenChange={setShowPasswordModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改密码</DialogTitle>
            <DialogDescription>
              为用户 &quot;{editingUser?.username}&quot; 设置新密码
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-password">新密码</Label>
              <Input
                id="edit-password"
                type="password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                placeholder="请输入新密码（至少4个字符）"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowPasswordModal(false);
                setEditingUser(null);
                setNewUserPassword("");
              }}
            >
              取消
            </Button>
            <Button onClick={handleUpdatePassword} disabled={updatingPassword}>
              {updatingPassword ? "修改中..." : "确认修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
