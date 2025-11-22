'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface MobileMenuProps {
  campaignId?: string;
  isGM?: boolean;
}

export function MobileMenu({ campaignId, isGM }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => setIsOpen(!isOpen);

  return (
    <>
      {/* Hamburger Button */}
      <Button
        onClick={toggleMenu}
        variant="ghost"
        className="md:hidden p-2"
        aria-label="Toggle menu"
      >
        <div className="space-y-1.5">
          <div className={`w-6 h-0.5 bg-gray-300 transition-transform ${isOpen ? 'rotate-45 translate-y-2' : ''}`} />
          <div className={`w-6 h-0.5 bg-gray-300 transition-opacity ${isOpen ? 'opacity-0' : ''}`} />
          <div className={`w-6 h-0.5 bg-gray-300 transition-transform ${isOpen ? '-rotate-45 -translate-y-2' : ''}`} />
        </div>
      </Button>

      {/* Mobile Menu Overlay */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={toggleMenu}
          />
          <div className="fixed top-0 right-0 bottom-0 w-64 bg-gray-900 z-50 md:hidden shadow-xl">
            <div className="p-4">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Menu</h2>
                <Button onClick={toggleMenu} variant="ghost" size="sm">
                  ✕
                </Button>
              </div>

              <nav className="space-y-2">
                {/* Home */}
                <Link
                  href="/"
                  className="block px-4 py-3 rounded hover:bg-gray-800 transition"
                  onClick={toggleMenu}
                >
                  🏠 Home
                </Link>

                {/* Campaign Links */}
                {campaignId && (
                  <>
                    <Link
                      href={`/campaigns/${campaignId}`}
                      className="block px-4 py-3 rounded hover:bg-gray-800 transition"
                      onClick={toggleMenu}
                    >
                      📋 Campaign Lobby
                    </Link>
                    <Link
                      href={`/campaigns/${campaignId}/story`}
                      className="block px-4 py-3 rounded hover:bg-gray-800 transition"
                      onClick={toggleMenu}
                    >
                      🎬 Story View
                    </Link>
                    {isGM && (
                      <Link
                        href={`/campaigns/${campaignId}/admin`}
                        className="block px-4 py-3 rounded hover:bg-gray-800 transition"
                        onClick={toggleMenu}
                      >
                        ⚙️ Admin
                      </Link>
                    )}
                  </>
                )}

                {/* Divider */}
                <div className="border-t border-gray-700 my-2" />

                {/* User Links */}
                <Link
                  href="/profile"
                  className="block px-4 py-3 rounded hover:bg-gray-800 transition"
                  onClick={toggleMenu}
                >
                  👤 Profile
                </Link>
                <Link
                  href="/campaigns"
                  className="block px-4 py-3 rounded hover:bg-gray-800 transition"
                  onClick={toggleMenu}
                >
                  🎮 My Campaigns
                </Link>

                {/* Divider */}
                <div className="border-t border-gray-700 my-2" />

                {/* Help & Settings */}
                <Link
                  href="/help"
                  className="block px-4 py-3 rounded hover:bg-gray-800 transition"
                  onClick={toggleMenu}
                >
                  ❓ Help
                </Link>
                <Link
                  href="/settings"
                  className="block px-4 py-3 rounded hover:bg-gray-800 transition"
                  onClick={toggleMenu}
                >
                  ⚙️ Settings
                </Link>
              </nav>
            </div>
          </div>
        </>
      )}
    </>
  );
}
