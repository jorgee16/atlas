export class MinPriorityQueue {
  constructor() {
    this.nodes = [];
    this.priorities = [];
  }

  get size() {
    return this.nodes.length;
  }

  clear() {
    this.nodes.length = 0;
    this.priorities.length = 0;
  }

  push(node, priority) {
    let index = this.nodes.length;

    this.nodes.push(node);
    this.priorities.push(priority);

    while (index > 0) {
      const parent =
        Math.floor((index - 1) / 2);

      if (
        this.priorities[parent] <=
        priority
      ) {
        break;
      }

      this.nodes[index] =
        this.nodes[parent];

      this.priorities[index] =
        this.priorities[parent];

      index = parent;
    }

    this.nodes[index] = node;
    this.priorities[index] = priority;
  }

  pop() {
    if (!this.nodes.length) {
      return null;
    }

    const node = this.nodes[0];
    const priority = this.priorities[0];

    const lastNode = this.nodes.pop();
    const lastPriority =
      this.priorities.pop();

    if (this.nodes.length) {
      let index = 0;

      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;

        if (left >= this.nodes.length) {
          break;
        }

        let child = left;

        if (
          right < this.nodes.length &&
          this.priorities[right] <
            this.priorities[left]
        ) {
          child = right;
        }

        if (
          this.priorities[child] >=
          lastPriority
        ) {
          break;
        }

        this.nodes[index] =
          this.nodes[child];

        this.priorities[index] =
          this.priorities[child];

        index = child;
      }

      this.nodes[index] = lastNode;
      this.priorities[index] =
        lastPriority;
    }

    return {
      node,
      priority
    };
  }
}
