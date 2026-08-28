import { Redirect } from 'expo-router';

// The root layout decides where a user actually belongs based on their signup
// step and ban state; this just gives '/' somewhere to land.
export default function Index() {
  return <Redirect href="/(app)/groups" />;
}
