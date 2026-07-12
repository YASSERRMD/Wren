# Managing Tasks

Tasks are the core unit of work in TaskFlow. This guide covers task
basics through to the deepest configuration options for recurring
subtask templates.

## Task basics

Every task has a title, an optional description, an optional due date,
and can be assigned to one teammate. Tasks live inside a project and can
be moved between projects at any time from the task's detail view.

### Subtasks

A task can have subtasks: smaller pieces of work that must be completed
before the parent task is considered done. Add a subtask from the task
detail view by clicking "Add subtask". Subtasks can themselves be
assigned to different teammates than the parent task.

#### Recurring subtasks

A subtask can be marked recurring, meaning a fresh copy of it is created
automatically on a schedule (daily, weekly, or monthly) once the current
one is completed. Recurring subtasks are useful for routine checklist
items that repeat, like a weekly status update.

##### Recurring subtask templates

Instead of configuring a recurring subtask from scratch every time, you
can save one as a template. Templates are reusable across every project
in your team, and appear in the "Add from template" menu when creating a
new subtask.

###### Advanced template rules

Templates support conditional rules: a rule can skip creating the next
occurrence if a linked field (for example, a custom "on vacation" flag on
the assignee) is set, or can reassign the new occurrence to a different
teammate on a rotation. Rules are configured in Settings > Templates >
Rules, and apply the next time the template's recurring schedule fires,
not retroactively to occurrences already created.

## Due dates and reminders

Setting a due date on a task shows it on the team calendar. TaskFlow
sends a reminder notification 24 hours before a task's due date by
default; this can be changed per task or turned off entirely in your
personal notification settings.

## Labels

Labels are short, colored tags you can attach to a task for filtering.
Create a new label from any task's detail view by typing a name that
does not already exist.
