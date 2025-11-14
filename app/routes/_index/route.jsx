// app/routes/_index/route.jsx
import { redirect } from "react-router";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    // 带 shop 参数时，统一丢到 /app，走嵌入式 Admin 流程
    throw redirect(`/app${url.search}`);
  }

  // 没有 shop，也直接重定向到 /app
  throw redirect(`/app${url.search}`);
};

export default function IndexRedirect() {
  // 基本不会渲染到这里，预防性返回 null
  return null;
}
