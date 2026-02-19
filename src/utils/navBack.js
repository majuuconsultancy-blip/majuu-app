export function smartBack(navigate, fallback = "/dashboard") {
  if (typeof window !== "undefined" && window.history.length > 1) {
    navigate(-1);
    return;
  }

  navigate(fallback, { replace: true });
}
