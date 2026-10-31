import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { RequireAuth } from './components/common';
import { AuthProvider } from './context/AuthContext';
import Home from './pages/Home';
import Article from './pages/Article';
import Search from './pages/Search';
import { Login, Register } from './pages/Auth';
import { MyProfile, NotFound, UserProfile } from './pages/Profile';
import AdminLayout, { Dashboard } from './pages/admin/AdminLayout';
import { ArticleEditor, Articles, Taxonomy } from './pages/admin/Content';
import { Comments, Reports } from './pages/admin/Moderation';
import { Analytics, SeoList } from './pages/admin/Seo';
import { Logs, SearchLogs, Settings, Users } from './pages/admin/System';
import { STAFF_PERMISSIONS } from './utils';
import './styles.css';

const guard = (permissions, element) => <RequireAuth permissions={permissions}>{element}</RequireAuth>;

ReactDOM.createRoot(document.getElementById('root')).render(
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
            <Route path="profile" element={guard(null, <MyProfile />)} />
            <Route path="u/:username" element={<UserProfile />} />
            <Route path="admin" element={guard(STAFF_PERMISSIONS, <AdminLayout />)}>
              <Route index element={<Dashboard />} />
              <Route path="articles" element={guard(['content:manage'], <Articles />)} />
              <Route path="articles/new" element={guard(['content:manage'], <ArticleEditor />)} />
              <Route path="articles/:id" element={guard(['content:manage'], <ArticleEditor />)} />
              <Route path="taxonomy" element={guard(['taxonomy:manage'], <Taxonomy />)} />
              <Route path="comments" element={guard(['comments:moderate'], <Comments />)} />
              <Route path="reports" element={guard(['reports:handle'], <Reports />)} />
              <Route path="seo" element={guard(['seo:manage'], <SeoList />)} />
              <Route path="analytics" element={guard(['analytics:view'], <Analytics />)} />
              <Route path="users" element={guard(['users:manage'], <Users />)} />
              <Route path="logs" element={guard(['logs:view'], <Logs />)} />
              <Route path="search-logs" element={guard(['logs:view', 'analytics:view'], <SearchLogs />)} />
              <Route path="settings" element={guard(['settings:manage'], <Settings />)} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
