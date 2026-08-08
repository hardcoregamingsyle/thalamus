import { motion } from "framer-motion";
import { Link } from "react-router";

// 404 page. Uses theme tokens (not literal gray-*) so the text is actually
// visible on the default dark theme, and offers a way back home.
export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen flex flex-col"
    >
      <meta name="robots" content="noindex" />

      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="text-center px-4">
          <h1 className="text-4xl font-bold text-foreground mb-4">404</h1>
          <p className="text-lg text-muted-foreground mb-6">Page Not Found</p>
          <Link
            to="/"
            className="inline-block px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Back to home
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
