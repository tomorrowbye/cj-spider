import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useState } from "react";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize?: number;
  total?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  showPageSizeSelector?: boolean;
  showQuickJumper?: boolean;
  showTotal?: boolean;
}

export function Pagination({
  currentPage,
  totalPages,
  pageSize = 20,
  total = 0,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  showPageSizeSelector = true,
  showQuickJumper = true,
  showTotal = true,
}: PaginationProps) {
  const [jumpPage, setJumpPage] = useState("");

  // 生成页码按钮数组
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 7; // 最多显示7个页码按钮

    if (totalPages <= maxVisible) {
      // 如果总页数小于等于7，显示所有页码
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // 总是显示第一页
      pages.push(1);

      if (currentPage <= 3) {
        // 当前页在前面
        for (let i = 2; i <= 5; i++) {
          pages.push(i);
        }
        pages.push("...");
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        // 当前页在后面
        pages.push("...");
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // 当前页在中间
        pages.push("...");
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push("...");
        pages.push(totalPages);
      }
    }

    return pages;
  };

  const handleJumpToPage = () => {
    const page = parseInt(jumpPage);
    if (page >= 1 && page <= totalPages) {
      onPageChange(page);
      setJumpPage("");
    }
  };

  const handlePageSizeChange = (value: string) => {
    const newPageSize = parseInt(value);
    onPageSizeChange?.(newPageSize);
    // 切换每页条数后，回到第一页
    onPageChange(1);
  };

  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t">
      {/* 左侧：总数和每页条数 */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        {showTotal && (
          <span>
            共 {total} 条记录
          </span>
        )}
        {showPageSizeSelector && onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span>每页</span>
            <Select
              value={pageSize.toString()}
              onValueChange={handlePageSizeChange}
            >
              <SelectTrigger className="w-[70px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>条</span>
          </div>
        )}
      </div>

      {/* 右侧：分页控制 */}
      <div className="flex items-center gap-2">
        {/* 首页 */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="h-8 w-8 p-0"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>

        {/* 上一页 */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="h-8 w-8 p-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* 页码按钮 */}
        <div className="hidden sm:flex items-center gap-1">
          {getPageNumbers().map((page, index) =>
            page === "..." ? (
              <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">
                ...
              </span>
            ) : (
              <Button
                key={page}
                variant={currentPage === page ? "default" : "outline"}
                size="sm"
                onClick={() => onPageChange(page as number)}
                className="h-8 min-w-8 px-2"
              >
                {page}
              </Button>
            ),
          )}
        </div>

        {/* 移动端：当前页/总页数 */}
        <div className="sm:hidden text-sm text-muted-foreground">
          {currentPage} / {totalPages}
        </div>

        {/* 下一页 */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="h-8 w-8 p-0"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* 末页 */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="h-8 w-8 p-0"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>

        {/* 快速跳转 */}
        {showQuickJumper && (
          <div className="hidden md:flex items-center gap-2 ml-2">
            <span className="text-sm text-muted-foreground">跳至</span>
            <Input
              type="number"
              min={1}
              max={totalPages}
              value={jumpPage}
              onChange={(e) => setJumpPage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleJumpToPage();
                }
              }}
              className="h-8 w-16 text-center"
              placeholder={currentPage.toString()}
            />
            <span className="text-sm text-muted-foreground">页</span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleJumpToPage}
              className="h-8"
            >
              跳转
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
