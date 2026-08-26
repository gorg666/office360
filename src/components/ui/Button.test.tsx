import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children text", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("renders with an icon and children", () => {
    render(
      <Button icon={<span data-testid="icon">I</span>}>
        Save
      </Button>,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("applies primary variant classes", () => {
    render(<Button variant="primary">Primary</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-brand");
    expect(btn.className).toContain("text-brand-contrast");
  });

  it("applies secondary variant classes by default", () => {
    render(<Button>Default</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-surface-raised");
    expect(btn.className).toContain("border-outline");
  });

  it("applies ghost variant classes", () => {
    render(<Button variant="ghost">Ghost</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("text-ink-secondary");
  });

  it("applies subtle variant classes", () => {
    render(<Button variant="subtle">Subtle</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-brand-tint-1");
    expect(btn.className).toContain("text-brand-text");
  });

  it("applies danger variant classes", () => {
    render(<Button variant="danger">Delete</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-danger-solid");
  });

  it("every variant carries the shared focus and pressed treatment", () => {
    for (const variant of ["primary", "secondary", "ghost", "subtle", "danger"] as const) {
      const { unmount } = render(<Button variant={variant}>V</Button>);
      const btn = screen.getByRole("button");
      expect(btn.className).toContain("focus-ring");
      expect(btn.className).toContain("pressable");
      unmount();
    }
  });

  it("applies iconOnly sizing as a square with no horizontal padding", () => {
    render(<Button iconOnly size="md" icon={<span>X</span>} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("h-8");
    expect(btn.className).toContain("w-8");
    expect(btn.className).not.toContain("px-");
  });

  it("applies standard sizing for non-iconOnly", () => {
    render(<Button size="md">Medium</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("px-3.5");
    expect(btn.className).toContain("text-control");
  });

  it("applies xs size", () => {
    render(<Button size="xs">Tiny</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("h-6");
    expect(btn.className).toContain("px-2");
  });

  it("applies lg size", () => {
    render(<Button size="lg">Large</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("h-10");
    expect(btn.className).toContain("text-copy");
  });

  it("marks itself busy and blocks clicks while loading", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Saving</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps its accessible name while loading", () => {
    render(<Button loading>Saving</Button>);
    expect(screen.getByRole("button", { name: /saving/i })).toBeInTheDocument();
  });

  it("handles disabled state", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Disabled</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Clickable</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("merges custom className", () => {
    render(<Button className="custom-class">Custom</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("custom-class");
  });

  it("passes through additional HTML attributes", () => {
    render(<Button title="tooltip" data-testid="my-btn">Attrs</Button>);
    const btn = screen.getByTestId("my-btn");
    expect(btn).toHaveAttribute("title", "tooltip");
  });

  it("forwards ref to the button element", () => {
    const ref = { current: null } as React.RefObject<HTMLButtonElement | null>;
    render(<Button ref={ref}>Ref</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
