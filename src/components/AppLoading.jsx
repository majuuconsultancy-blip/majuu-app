import GlobalLoader from "./GlobalLoader";

export default function AppLoading({
  title = "Loading...",
  subtitle = "",
  showAppName = false,
  appName = "MAJUU",
  logoSrc = "",
  logoAlt = "",
} = {}) {
  return (
    <GlobalLoader
      isLoading
      overlay={false}
      loadingText={title}
      caption={subtitle}
      showAppName={showAppName}
      appName={appName}
      logoSrc={logoSrc}
      logoAlt={logoAlt}
    />
  );
}
