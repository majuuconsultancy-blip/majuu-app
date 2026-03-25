import GlobalLoader from "./GlobalLoader";

export default function ScreenLoader({
  title = "Loading...",
  subtitle = "",
  hint = "",
  variant = "default",
}) {
  return (
    <GlobalLoader
      isLoading
      overlay={false}
      loadingText={title}
      caption={variant === "minimal" ? subtitle : [subtitle, hint].filter(Boolean).join(" ")}
    />
  );
}
