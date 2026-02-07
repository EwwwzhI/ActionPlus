import React from "react";
import { StatusBar } from "react-native";
import { HomeScreen } from "./src/HomeScreen";
import { theme } from "./src/theme";

export default function App() {
  return (
    <>
      <StatusBar barStyle="dark-content" backgroundColor={theme.colors.background} />
      <HomeScreen />
    </>
  );
}
