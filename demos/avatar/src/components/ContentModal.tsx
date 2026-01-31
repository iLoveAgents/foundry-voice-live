import {
  Drawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
  Button,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";

const useStyles = makeStyles({
  content: {
    overflowY: "auto",
    padding: "0",
  },
  contentInner: {
    padding: "20px",
  },
  markdownContent: {
    "& h1": {
      fontSize: tokens.fontSizeBase600,
      fontWeight: tokens.fontWeightSemibold,
      marginTop: "16px",
      marginBottom: "8px",
    },
    "& h2": {
      fontSize: tokens.fontSizeBase500,
      fontWeight: tokens.fontWeightSemibold,
      marginTop: "14px",
      marginBottom: "6px",
    },
    "& h3": {
      fontSize: tokens.fontSizeBase400,
      fontWeight: tokens.fontWeightSemibold,
      marginTop: "12px",
      marginBottom: "4px",
    },
    "& p": {
      marginBottom: "12px",
      lineHeight: "1.6",
    },
    "& ul, & ol": {
      marginBottom: "12px",
      paddingLeft: "24px",
    },
    "& li": {
      marginBottom: "4px",
    },
    "& code": {
      backgroundColor: tokens.colorNeutralBackground3,
      padding: "2px 6px",
      borderRadius: "4px",
      fontFamily: "monospace",
      fontSize: "0.9em",
    },
    "& pre": {
      backgroundColor: tokens.colorNeutralBackground3,
      padding: "12px",
      borderRadius: "6px",
      overflowX: "auto",
      marginBottom: "12px",
    },
    "& pre code": {
      backgroundColor: "transparent",
      padding: 0,
    },
  },
  textContent: {
    whiteSpace: "pre-wrap",
    fontFamily: tokens.fontFamilyBase,
    lineHeight: "1.6",
  },
  mermaidContainer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "20px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "6px",
    width: "100%",
    "& > div": {
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      width: "100%",
      maxWidth: "100%",
    },
    "& svg": {
      maxWidth: "100%",
      height: "auto",
      display: "block",
    },
  },
});

export interface ContentModalProps {
  open: boolean;
  title: string;
  content: string;
  contentType: "text" | "markdown" | "mermaid";
  size?: "small" | "medium" | "large" | "full";
  onClose: () => void;
}

export const ContentModal = ({
  open,
  title,
  content,
  contentType,
  size = "large",
  onClose,
}: ContentModalProps) => {
  const styles = useStyles();
  const mermaidRef = useRef<HTMLDivElement>(null);
  const [mermaidError, setMermaidError] = useState<string | null>(null);

  useEffect(() => {
    if (open && contentType === "mermaid" && mermaidRef.current && content) {
      setMermaidError(null);

      // Clear previous content
      mermaidRef.current.innerHTML = '';

      // Dynamically load and render mermaid
      import("mermaid").then(async (mermaidModule) => {
        const mermaid = mermaidModule.default;

        // Initialize mermaid
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
        });

        try {
          // Generate unique ID for this diagram
          const id = `mermaid-${Date.now()}`;

          // Render the diagram
          const { svg } = await mermaid.render(id, content);

          if (mermaidRef.current) {
            mermaidRef.current.innerHTML = svg;
          }
        } catch (error) {
          console.error('Mermaid rendering error:', error);
          setMermaidError(error instanceof Error ? error.message : 'Failed to render diagram');
        }
      });
    }
  }, [open, contentType, content]);

  const renderContent = () => {
    switch (contentType) {
      case "markdown":
        return (
          <div className={styles.contentInner}>
            <div
              className={styles.markdownContent}
              dangerouslySetInnerHTML={{
                __html: parseSimpleMarkdown(content),
              }}
            />
          </div>
        );
      case "mermaid":
        return (
          <div className={styles.mermaidContainer}>
            {mermaidError ? (
              <div style={{ color: 'red', padding: '20px' }}>
                <strong>Diagram Error:</strong><br />
                {mermaidError}
                <pre style={{ marginTop: '10px', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
                  {content}
                </pre>
              </div>
            ) : (
              <div ref={mermaidRef} />
            )}
          </div>
        );
      case "text":
      default:
        return (
          <div className={styles.contentInner}>
            <div className={styles.textContent}>{content}</div>
          </div>
        );
    }
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(_, { open: isOpen }) => {
        if (!isOpen) {
          onClose();
        }
      }}
      position="end"
      size={size}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              aria-label="close"
              icon={<Dismiss24Regular />}
              onClick={onClose}
            />
          }
        >
          {title}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody className={styles.content}>
        {renderContent()}
      </DrawerBody>
    </Drawer>
  );
};

// Simple markdown parser (basic implementation)
function parseSimpleMarkdown(markdown: string): string {
  let html = markdown;

  // Headers
  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Line breaks
  html = html.replace(/\n\n/g, "</p><p>");
  html = html.replace(/\n/g, "<br>");

  // Wrap in paragraph if not already wrapped
  if (!html.startsWith("<")) {
    html = "<p>" + html + "</p>";
  }

  // Lists - fixed regex without 's' flag
  html = html.replace(/^\* (.*)$/gim, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]*<\/li>)/g, "<ul>$1</ul>");

  return html;
}
