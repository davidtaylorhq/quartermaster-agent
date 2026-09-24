---
name: review
description: "Attach a comment to a specific line of the pull request"
user-invocable: false
tools:
  - name: line_comment
    description: "Note a comment against one line of the diff. Collected and posted as a single review when you finish. Only lines the pull request touches can be commented on."
    script: scripts/line-comment.sh
    call: json
    input:
      type: object
      properties:
        path:
          type: string
          description: "File path, as it appears in the diff"
        line:
          type: integer
          description: "Line number in the file after the change"
        body:
          type: string
          description: "Markdown. A ```suggestion fence applies in one click."
      required: [path, line, body]
---

# Line comments

Call `line_comment` as you find things. Nothing is posted when you call it; the
comments are held and posted together as one review when you finish, so the
author gets a single notification rather than one per point.
