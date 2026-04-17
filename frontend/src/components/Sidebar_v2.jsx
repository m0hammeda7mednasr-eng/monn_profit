import React from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  Menu,
  X,
  LogOut,
  Home,
  ShoppingCart,
  Package,
  Users,
  Settings,
} from "lucide-react";
import { useState } from "react";
import moonLogo from "../assets/moon-logo.jpeg";

export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };

  const isActive = (path) => location.pathname === path;

  const menuItems = [
    { icon: Home, label: "Dashboard", path: "/dashboard" },
    { icon: ShoppingCart, label: "Orders", path: "/orders" },
    { icon: Package, label: "Products", path: "/products" },
    { icon: Users, label: "Customers", path: "/customers" },
  ];

  return (
    <>
      {/* Mobile Menu Toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700"
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Sidebar */}
      <aside
        className={`fixed lg:static top-0 left-0 h-screen ${isOpen ? "w-64" : "w-0"} lg:w-64 bg-gradient-to-b from-blue-700 to-blue-900 text-white transition-all duration-300 z-40 overflow-y-auto`}
      >
        <div className="p-6 border-b border-blue-600">
          <div className="flex items-center gap-3">
            <img
              src={moonLogo}
              alt="Moon Profit logo"
              className="h-11 w-11 rounded-xl object-cover ring-2 ring-blue-300/50"
              loading="lazy"
            />
            <div>
              <h1 className="text-2xl font-bold">Moon Profit</h1>
              <p className="text-blue-200 text-sm">Moon Profit Platform</p>
            </div>
          </div>
        </div>

        <nav className="mt-6">
          {menuItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-6 py-3 ${
                isActive(item.path)
                  ? "bg-blue-600 border-l-4 border-blue-300"
                  : "hover:bg-blue-600"
              } transition`}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="absolute bottom-6 left-6 right-6 space-y-2">
          <button className="w-full flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition text-left">
            <Settings size={20} />
            <span>Settings</span>
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg transition"
          >
            <LogOut size={20} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Overlay for Mobile */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
        />
      )}
    </>
  );
}
