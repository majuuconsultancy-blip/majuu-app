import GlobalLoader from "./GlobalLoader";

export default function AppLoading() {
  return <GlobalLoader isLoading overlay={false} loadingText="Loading..." />;
}
