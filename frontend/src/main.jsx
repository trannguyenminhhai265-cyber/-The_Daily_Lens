import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { RequireAuth } from "./components/common";
import { AuthProvider } from "./context/AuthContext";
import Home from "./pages/Home";
import Article from "./pages/Article";
import Search from "./pages/Search";
import { Login, Register, ResetPassword } from "./pages/Auth";
import { MyProfile, NotFound } from "./pages/Profile";
import AdminLayout, { Dashboard } from "./pages/admin/AdminLayout";
import { ArticleEditor, Articles, Taxonomy } from "./pages/admin/Content";
import { SearchLogs } from "./pages/admin/SearchLogs";
import { SearchEngine } from "./pages/admin/SearchEngine";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="article/:slug" element={<Article />} />
            <Route path="search" element={<Search />} />
            <Route path="category/:slug" element={<Search mode="category" />} />
            <Route path="tag/:slug" element={<Search mode="tag" />} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="reset-password" element={<ResetPassword />} />
            <Route path="profile" element={<RequireAuth><MyProfile /></RequireAuth>} />
            <Route
              path="admin"
              element={<RequireAuth adminOnly><AdminLayout /></RequireAuth>}
            >
              <Route index element={<Dashboard />} />
              <Route
                path="articles"
                element={<Articles />}
              />
              <Route
                path="articles/new"
                element={<ArticleEditor />}
              />
              <Route
                path="articles/:id"
                element={<ArticleEditor />}
              />
              <Route
                path="taxonomy"
                element={<Taxonomy />}
              />
              <Route
                path="search-engine"
                element={<SearchEngine />}
              />
              <Route
                path="search-logs"
                element={<SearchLogs />}
              />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
