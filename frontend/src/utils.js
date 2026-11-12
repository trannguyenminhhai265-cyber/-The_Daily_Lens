const LOCALE = "vi-VN";

export function formatDate(
  value,
  opts = { year: "numeric", month: "short", day: "numeric" },
) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(LOCALE, opts);
}

export function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function timeAgo(value) {
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 60) return "vừa xong";
  const units = [
    ["năm", 31536000],
    ["tháng", 2592000],
    ["tuần", 604800],
    ["ngày", 86400],
    ["giờ", 3600],
    ["phút", 60],
  ];
  for (const [name, secs] of units) {
    const n = Math.floor(diff / secs);
    if (n >= 1) return `${n} ${name} trước`;
  }
  return "vừa xong";
}

export function compact(n) {
  return new Intl.NumberFormat(LOCALE).format(n || 0);
}

export function initials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

export const ROLE_LABELS = { admin: "Quản trị viên", user: "Độc giả" };

// Category names are stored in English in the database; show them in Vietnamese.
const CATEGORY_LABELS = {
  travel: "Du lịch",
  business: "Kinh doanh",
  health: "Sức khỏe",
  technology: "Công nghệ",
  science: "Khoa học",
  culture: "Văn hóa",
  sports: "Thể thao",
  environment: "Môi trường",
};

export function categoryLabel(category) {
  if (!category) return "";
  return CATEGORY_LABELS[category.slug] || category.name;
}

// Server / Supabase Auth messages are English; show Vietnamese equivalents.
const ERROR_MESSAGES = {
  "Invalid login credentials": "Email hoặc mật khẩu không đúng",
  "Email not confirmed": "Email chưa được xác nhận",
  "User already registered": "Email này đã được đăng ký",
  "New password should be different from the old password.":
    "Mật khẩu mới phải khác mật khẩu cũ",
  "Password must contain at least 8 characters, one letter and one number":
    "Mật khẩu cần có ít nhất 8 ký tự, gồm chữ cái và chữ số",
  "Registration is currently disabled": "Hiện chưa mở đăng ký tài khoản mới",
  "Admin access required": "Cần quyền quản trị viên",
  "Account not available": "Tài khoản không khả dụng",
  "Authentication required": "Vui lòng đăng nhập để tiếp tục",
  "Invalid method": "Yêu cầu không hợp lệ",
  "Choose another category for these articles":
    "Hãy chọn chuyên mục khác cho các bài viết này",
  "Invalid taxonomy operation": "Thao tác chuyên mục/thẻ không hợp lệ",
  "Invalid article operation": "Thao tác bài viết không hợp lệ",
  "Invalid tag": "Thẻ không hợp lệ",
  "Title is required": "Vui lòng nhập tiêu đề",
  "Article not found": "Không tìm thấy bài viết",
  "Route not found": "Không tìm thấy trang yêu cầu",
  "Failed to fetch": "Không thể kết nối tới máy chủ",
  "Email rate limit exceeded":
    "Bạn gửi quá nhiều yêu cầu email, vui lòng thử lại sau",
  "Auth session missing!":
    "Phiên đăng nhập không hợp lệ hoặc đã hết hạn, vui lòng mở lại liên kết trong email",
};

export function translateError(message) {
  if (!message) return message;
  if (ERROR_MESSAGES[message]) return ERROR_MESSAGES[message];
  if (/duplicate key|already exists/i.test(message))
    return "Dữ liệu này đã tồn tại";
  if (/Password should be at least/i.test(message))
    return "Mật khẩu quá ngắn";
  if (/security purposes|rate limit/i.test(message))
    return "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút";
  return message;
}

export function setPageMeta(title, description) {
  document.title = title;
  if (description !== undefined) {
    let tag = document.querySelector('meta[name="description"]');
    if (!tag) {
      tag = document.createElement("meta");
      tag.name = "description";
      document.head.appendChild(tag);
    }
    tag.content = description;
  }
}
