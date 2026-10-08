import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty">
      <p>That page doesn't exist. Addresses need to be full 42-character 0x addresses.</p>
      <p>
        <Link href="/">Back to the feed</Link>
      </p>
    </div>
  );
}
