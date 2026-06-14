'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  createdAt: string;
}

export default function SettingsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const [deletingId, setDeletingId] = useState('');
  const router = useRouter();

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      if (res.status === 403) {
        router.push('/');
        return;
      }
      const data = await res.json();
      setUsers(data.users || []);
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // Read current user from cookie via a simple API call
    fetch('/api/users')
      .then((r) => {
        if (r.status === 403) { router.push('/'); return null; }
        return r.json();
      })
      .then((data) => {
        if (data) setUsers(data.users || []);
        setLoading(false);
      })
      .catch(() => { setError('Failed to load users'); setLoading(false); });
  }, [router, fetchUsers]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError('');

    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUsername, password: newPassword, displayName: newDisplayName || newUsername }),
    });

    if (res.ok) {
      const data = await res.json();
      setUsers((prev) => [...prev, data.user]);
      setNewUsername('');
      setNewPassword('');
      setNewDisplayName('');
    } else {
      const data = await res.json();
      setAddError(data.error || 'Failed to create user');
    }
    setAdding(false);
  };

  const handleDelete = async (userId: string, username: string) => {
    if (!confirm(`Delete user "${username}"?`)) return;
    setDeletingId(userId);
    const res = await fetch(`/api/users?id=${userId}`, { method: 'DELETE' });
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    }
    setDeletingId('');
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm flex items-center gap-1">
              ← Gallery
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors"
          >
            Sign Out
          </button>
        </div>

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

        {/* Users list */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Users</h2>
            <p className="text-sm text-gray-500 mt-0.5">{users.length} member{users.length !== 1 ? 's' : ''}</p>
          </div>

          {users.length === 0 ? (
            <p className="px-6 py-8 text-gray-400 text-sm text-center">No users found</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {users.map((user) => (
                <div key={user.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 text-sm">{user.displayName}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${user.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                        {user.role}
                      </span>
                    </div>
                    <p className="text-gray-500 text-xs mt-0.5" suppressHydrationWarning>@{user.username} · joined {new Date(user.createdAt).toLocaleDateString()}</p>
                  </div>
                  {user.role !== 'admin' && (
                    <button
                      onClick={() => handleDelete(user.id, user.username)}
                      disabled={deletingId === user.id}
                      className="text-red-500 hover:text-red-700 text-sm px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {deletingId === user.id ? '...' : 'Remove'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add user form */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Add Member</h2>

          <form onSubmit={handleAddUser} className="space-y-3">
            <input
              type="text"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="Display name (e.g. Anna)"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="Username (e.g. anna)"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="off"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="new-password"
            />

            {addError && <p className="text-red-500 text-sm">{addError}</p>}

            <button
              type="submit"
              disabled={adding || !newUsername || !newPassword}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {adding ? 'Adding...' : 'Add Member'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
