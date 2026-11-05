use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Context, Div, Entity, FontWeight, InteractiveElement, IntoElement,
    ParentElement, Render, Rgba, SharedString, StatefulInteractiveElement, Styled, Window, div, px,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::right_panel_agents::{
    AgentActivityTone, AgentDirectSectionView, AgentMemberDotView, AgentPhaseRailSegmentView,
    AgentPhaseTone, AgentPhaseView, AgentRowView, AgentStatusTone, AgentWorkflowView,
    AgentsEmptyView, AgentsFooterView, RightPanelAgentsView, WorkflowScriptBodyView,
    WorkflowScriptView,
};
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::menu::{icon, tracked_text};
use crate::ui::scroll_area::ScrollArea;
use crate::ui::theme;
use crate::ui::theme::metrics::radius;
use crate::ui::theme::tokens::{Tokens, fade};

const TEXT_3XS: f32 = 10.;
const TEXT_3XS_LINE: f32 = 14.;
const TEXT_2XS: f32 = 11.;
const TEXT_2XS_LINE: f32 = 16.;
const TEXT_XS: f32 = 12.;
const TEXT_XS_LINE: f32 = 16.;
const TEXT_SM: f32 = 14.;
const TEXT_SM_LINE: f32 = 20.;
const SCRIPT_LINE: f32 = 17.875;
const TRACKING_WIDER: f32 = 0.5;
const DOT: f32 = 6.;
const ICON_XS: f32 = 12.;
const EMPTY_ICON: f32 = 24.;
const EMPTY_PADDING: f32 = 24.;
const EMPTY_GAP: f32 = 8.;
const EMPTY_DESCRIPTION_MAX_WIDTH: f32 = 224.;
const LIST_PADDING: f32 = 8.;
const LIST_GAP: f32 = 8.;
const ROW_HEIGHT: f32 = 62.;
const ROW_PADDING_X: f32 = 6.;
const ROW_PADDING_Y: f32 = 4.;
const ROW_GAP: f32 = 8.;
const ROW_LINE_1: f32 = 20.;
const ROW_LINE_2: f32 = 18.;
const ROW_LINE_3: f32 = 16.;
const ROW_META_MIN_WIDTH: f32 = 56.;
const ROLE_MAX_WIDTH: f32 = 112.;
const ROLE_PADDING_X: f32 = 4.;
const SECTION_INSET_X: f32 = 6.;
const WORKFLOW_PADDING: f32 = 6.;
const HEADER_PADDING_TOP: f32 = 2.;
const HEADER_GAP: f32 = 8.;
const RAIL_PADDING_TOP: f32 = 6.;
const RAIL_PADDING_BOTTOM: f32 = 4.;
const RAIL_GAP: f32 = 4.;
const SEGMENT_PADDING_X: f32 = 6.;
const SEGMENT_PADDING_Y: f32 = 2.;
const DOTS_GAP: f32 = 2.;
const PHASE_MARGIN_TOP: f32 = 8.;
const PHASE_GAP: f32 = 6.;
const COLLAPSED_PADDING_Y: f32 = 4.;
const COLLAPSED_META_GAP: f32 = 6.;
const DIRECT_PADDING_TOP: f32 = 4.;
const SCRIPT_MARGIN_BOTTOM: f32 = 4.;
const SCRIPT_HEADER_PADDING_X: f32 = 8.;
const SCRIPT_HEADER_PADDING_Y: f32 = 4.;
const SCRIPT_BODY_PADDING: f32 = 8.;
const SCRIPT_MAX_HEIGHT: f32 = 288.;
const FOOTER_PADDING_X: f32 = 12.;
const FOOTER_PADDING_Y: f32 = 6.;
const FOOTER_GAP: f32 = 8.;

pub struct AgentsSurface {
    client: Entity<CoreClient>,
    state: Entity<ViewState<Option<RightPanelAgentsView>>>,
}

impl AgentsSurface {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let state = CoreClient::subscribe::<Option<RightPanelAgentsView>>(
            &client,
            "rightPanelAgents",
            json!({}),
            cx,
        );
        cx.observe(&state, |_, _, cx| cx.notify()).detach();
        Self { client, state }
    }
}

#[derive(Clone)]
struct Actions {
    client: Entity<CoreClient>,
}

impl Actions {
    fn handler(
        &self,
        action: &'static str,
        params: Value,
    ) -> impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static {
        let client = self.client.clone();
        move |_, _, cx| {
            let params = params.clone();
            client.update(cx, |client, _| client.act(action, params));
        }
    }
}

fn status_color(tone: AgentStatusTone, t: &Tokens) -> Rgba {
    match tone {
        AgentStatusTone::Working => t.info,
        AgentStatusTone::Idle => fade(t.muted_foreground, 0.5),
        AgentStatusTone::Success => t.success,
        AgentStatusTone::Failed => t.destructive,
        AgentStatusTone::Stopped => fade(t.muted_foreground, 0.6),
    }
}

fn phase_border(tone: AgentPhaseTone, t: &Tokens) -> Rgba {
    match tone {
        AgentPhaseTone::Info => fade(t.info, 0.4),
        AgentPhaseTone::Success => fade(t.success, 0.3),
        AgentPhaseTone::Muted => fade(t.border, 0.5),
    }
}

fn phase_text(tone: AgentPhaseTone, t: &Tokens) -> Rgba {
    match tone {
        AgentPhaseTone::Info => t.info_foreground,
        AgentPhaseTone::Success => t.success_foreground,
        AgentPhaseTone::Muted => fade(t.muted_foreground, 0.7),
    }
}

fn status_dot(tone: AgentStatusTone, t: &Tokens) -> Div {
    div()
        .size(px(DOT))
        .flex_none()
        .rounded_full()
        .bg(status_color(tone, t))
}

fn member_dots(dots: &[AgentMemberDotView], t: &Tokens) -> Vec<Div> {
    dots.iter().map(|dot| status_dot(dot.tone, t)).collect()
}

fn mono(size: f32, line: f32) -> Div {
    div()
        .font_family(MONO_FONT)
        .text_size(px(size))
        .line_height(px(line))
}

fn eyebrow(t: &Tokens) -> Div {
    div()
        .text_size(px(TEXT_3XS))
        .line_height(px(TEXT_3XS_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.muted_foreground)
}

fn empty_state(empty: &AgentsEmptyView, t: &Tokens) -> AnyElement {
    div()
        .size_full()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(EMPTY_GAP))
        .p(px(EMPTY_PADDING))
        .text_center()
        .child(icon("bot", EMPTY_ICON, fade(t.muted_foreground, 0.6)))
        .child(
            div()
                .text_size(px(TEXT_SM))
                .line_height(px(TEXT_SM_LINE))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.foreground)
                .child(empty.title.clone()),
        )
        .child(
            div()
                .max_w(px(EMPTY_DESCRIPTION_MAX_WIDTH))
                .text_size(px(TEXT_XS))
                .line_height(px(TEXT_XS_LINE))
                .text_color(t.muted_foreground)
                .child(empty.description.clone()),
        )
        .into_any_element()
}

fn agent_row(row: &AgentRowView, t: &Tokens) -> AnyElement {
    let activity_color = match row.activity_tone {
        AgentActivityTone::Failed => t.destructive_foreground,
        AgentActivityTone::Muted => t.muted_foreground,
    };
    div()
        .h(px(ROW_HEIGHT))
        .flex()
        .gap(px(ROW_GAP))
        .rounded(px(radius::MD))
        .px(px(ROW_PADDING_X))
        .py(px(ROW_PADDING_Y))
        .child(
            div()
                .w(px(DOT))
                .h(px(ROW_LINE_1))
                .flex_none()
                .flex()
                .items_center()
                .child(status_dot(row.status_tone, t)),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    div()
                        .h(px(ROW_LINE_1))
                        .flex()
                        .items_center()
                        .gap(px(ROW_GAP))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .h_full()
                                .flex()
                                .items_end()
                                .gap(px(ROW_GAP))
                                .child(
                                    div()
                                        .min_w_0()
                                        .truncate()
                                        .text_size(px(TEXT_SM))
                                        .line_height(px(TEXT_SM_LINE))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(t.foreground)
                                        .child(row.title.clone()),
                                )
                                .when_some(row.role.clone(), |this, role| {
                                    this.child(
                                        mono(TEXT_3XS, TEXT_3XS_LINE)
                                            .flex_none()
                                            .max_w(px(ROLE_MAX_WIDTH))
                                            .truncate()
                                            .rounded(px(radius::SM))
                                            .border_1()
                                            .border_color(fade(t.border, 0.6))
                                            .px(px(ROLE_PADDING_X))
                                            .text_color(t.muted_foreground)
                                            .child(role),
                                    )
                                }),
                        )
                        .child(
                            mono(TEXT_2XS, TEXT_2XS_LINE)
                                .flex_none()
                                .min_w(px(ROW_META_MIN_WIDTH))
                                .flex()
                                .items_center()
                                .justify_end()
                                .gap(px(4.))
                                .text_color(fade(t.muted_foreground, 0.8))
                                .when_some(row.elapsed.as_ref(), |this, elapsed| {
                                    this.child(
                                        div()
                                            .font_features(theme::tabular())
                                            .child(elapsed.text.clone()),
                                    )
                                })
                                .when(row.show_completed_check, |this| {
                                    this.child(icon("check", ICON_XS, t.success))
                                }),
                        ),
                )
                .child(
                    div().h(px(ROW_LINE_2)).flex().items_center().child(
                        div()
                            .w_full()
                            .min_w_0()
                            .truncate()
                            .text_size(px(TEXT_XS))
                            .line_height(px(TEXT_XS_LINE))
                            .text_color(activity_color)
                            .child(row.activity_text.clone()),
                    ),
                )
                .child(
                    mono(TEXT_2XS, TEXT_2XS_LINE)
                        .h(px(ROW_LINE_3))
                        .min_w_0()
                        .truncate()
                        .font_features(theme::tabular())
                        .text_color(fade(t.muted_foreground, 0.7))
                        .child(row.metadata_text.clone()),
                ),
        )
        .into_any_element()
}

fn phase_rail(segments: &[AgentPhaseRailSegmentView], t: &Tokens) -> Div {
    div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap_x(px(RAIL_GAP))
        .gap_y(px(RAIL_GAP))
        .px(px(SECTION_INSET_X))
        .pt(px(RAIL_PADDING_TOP))
        .pb(px(RAIL_PADDING_BOTTOM))
        .children(segments.iter().map(|segment| {
            div()
                .flex()
                .items_center()
                .gap(px(RAIL_GAP))
                .when(segment.show_separator, |this| {
                    this.child(icon(
                        "chevron-right",
                        ICON_XS,
                        fade(t.muted_foreground, 0.4),
                    ))
                })
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(RAIL_GAP))
                        .rounded(px(radius::SM))
                        .border_1()
                        .border_color(phase_border(segment.tone, t))
                        .px(px(SEGMENT_PADDING_X))
                        .py(px(SEGMENT_PADDING_Y))
                        .child(
                            mono(TEXT_3XS, TEXT_3XS_LINE)
                                .text_color(phase_text(segment.tone, t))
                                .child(segment.label.clone()),
                        )
                        .child(div().flex().items_center().gap(px(DOTS_GAP)).map(|this| {
                            match segment.empty_members_text.clone() {
                                Some(text) => this.child(
                                    mono(TEXT_3XS, TEXT_3XS_LINE)
                                        .text_color(fade(t.muted_foreground, 0.5))
                                        .child(text),
                                ),
                                None => this.children(member_dots(&segment.member_dots, t)),
                            }
                        })),
                )
        }))
}

fn script_view(
    workflow_id: &str,
    script: &WorkflowScriptView,
    actions: &Actions,
    t: &Tokens,
) -> AnyElement {
    let body = match &script.body {
        WorkflowScriptBodyView::Success { text } => mono(TEXT_2XS, SCRIPT_LINE)
            .text_color(fade(t.foreground, 0.9))
            .child(text.clone()),
        WorkflowScriptBodyView::Failure { text } => div()
            .text_size(px(TEXT_XS))
            .line_height(px(TEXT_XS_LINE))
            .text_color(t.destructive_foreground)
            .child(text.clone()),
        WorkflowScriptBodyView::Loading { text } => div()
            .text_size(px(TEXT_XS))
            .line_height(px(TEXT_XS_LINE))
            .text_color(t.muted_foreground)
            .child(text.clone()),
    };
    div()
        .mx(px(SECTION_INSET_X))
        .mb(px(SCRIPT_MARGIN_BOTTOM))
        .rounded(px(radius::MD))
        .border_1()
        .border_color(fade(t.border, 0.6))
        .bg(fade(t.background, 0.6))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(HEADER_GAP))
                .border_b_1()
                .border_color(fade(t.border, 0.5))
                .px(px(SCRIPT_HEADER_PADDING_X))
                .py(px(SCRIPT_HEADER_PADDING_Y))
                .child(icon("braces", ICON_XS, t.muted_foreground))
                .child(
                    mono(TEXT_3XS, TEXT_3XS_LINE)
                        .min_w_0()
                        .truncate()
                        .text_color(t.muted_foreground)
                        .child(script.file_name.clone()),
                )
                .child(
                    Button::new(SharedString::from(format!(
                        "agents-script-close-{workflow_id}"
                    )))
                    .variant(ButtonVariant::GhostMuted)
                    .size(ButtonSize::IconMicro)
                    .icon("x")
                    .icon_size(ICON_XS)
                    .accessibility_label(script.close_aria_label.clone())
                    .ml_auto()
                    .on_click(actions.handler(
                        "rightPanelAgentsCloseScript",
                        json!({ "workflowId": workflow_id }),
                    )),
                ),
        )
        .child(
            div()
                .id(SharedString::from(format!(
                    "agents-script-body-{workflow_id}"
                )))
                .max_h(px(SCRIPT_MAX_HEIGHT))
                .overflow_y_scroll()
                .p(px(SCRIPT_BODY_PADDING))
                .child(body),
        )
        .into_any_element()
}

fn phase_section(
    workflow_id: &str,
    phase: &AgentPhaseView,
    actions: &Actions,
    t: &Tokens,
) -> AnyElement {
    let color = phase_text(phase.tone, t);
    div()
        .child(
            div()
                .id(SharedString::from(format!(
                    "agents-phase-{workflow_id}-{}",
                    phase.index
                )))
                .mt(px(PHASE_MARGIN_TOP))
                .flex()
                .w_full()
                .items_center()
                .gap(px(PHASE_GAP))
                .rounded(px(radius::SM))
                .px(px(SECTION_INSET_X))
                .text_size(px(TEXT_3XS))
                .line_height(px(TEXT_3XS_LINE))
                .font_weight(FontWeight::MEDIUM)
                .text_color(color)
                .cursor_pointer()
                .hover(|style| style.bg(fade(t.accent, 0.4)))
                .child(icon(
                    if phase.open {
                        "chevron-down"
                    } else {
                        "chevron-right"
                    },
                    ICON_XS,
                    color,
                ))
                .when(phase.show_done_check, |this| {
                    this.child(icon("check", ICON_XS, color))
                })
                .child(tracked_text(&phase.title.to_uppercase(), TRACKING_WIDER))
                .child(
                    tracked_text(&phase.summary_text, TRACKING_WIDER)
                        .font_weight(FontWeight::NORMAL)
                        .text_color(fade(t.muted_foreground, 0.7)),
                )
                .when(!phase.open && !phase.member_dots.is_empty(), |this| {
                    this.child(
                        div()
                            .ml_auto()
                            .flex()
                            .items_center()
                            .gap(px(DOTS_GAP))
                            .children(member_dots(&phase.member_dots, t)),
                    )
                })
                .on_click(actions.handler(
                    "rightPanelAgentsTogglePhase",
                    json!({ "workflowId": workflow_id, "phaseIndex": phase.index }),
                )),
        )
        .when(phase.open, |this| {
            this.children(phase.rows.iter().map(|row| agent_row(row, t)))
        })
        .into_any_element()
}

fn workflow_section(workflow: &AgentWorkflowView, actions: &Actions, t: &Tokens) -> AnyElement {
    match workflow {
        AgentWorkflowView::Expanded {
            id,
            status_tone,
            title,
            script_toggle_label,
            settled_text,
            collapse_aria_label,
            can_show_script,
            script_open,
            script,
            phase_rail: rail,
            phases,
            unphased_rows,
            fallback_row,
        } => div()
            .rounded(px(radius::LG))
            .border_1()
            .border_color(fade(t.border, 0.5))
            .bg(fade(t.card, 0.3))
            .p(px(WORKFLOW_PADDING))
            .child(
                eyebrow(t)
                    .flex()
                    .items_center()
                    .gap(px(HEADER_GAP))
                    .px(px(SECTION_INSET_X))
                    .pt(px(HEADER_PADDING_TOP))
                    .child(status_dot(*status_tone, t))
                    .child(
                        div()
                            .min_w_0()
                            .overflow_hidden()
                            .child(tracked_text(&title.to_uppercase(), TRACKING_WIDER)),
                    )
                    .when(*can_show_script, |this| {
                        this.child(
                            div()
                                .id(SharedString::from(format!("agents-script-toggle-{id}")))
                                .flex_none()
                                .rounded(px(radius::SM))
                                .border_1()
                                .border_color(fade(t.border, 0.6))
                                .px(px(ROLE_PADDING_X))
                                .font_family(MONO_FONT)
                                .cursor_pointer()
                                .when(*script_open, |this| this.text_color(t.foreground))
                                .hover(|style| style.text_color(t.foreground))
                                .child(tracked_text(script_toggle_label, TRACKING_WIDER))
                                .on_click(actions.handler(
                                    "rightPanelAgentsToggleScript",
                                    json!({ "workflowId": id }),
                                )),
                        )
                    })
                    .child(
                        div()
                            .ml_auto()
                            .flex_none()
                            .font_family(MONO_FONT)
                            .text_color(fade(t.muted_foreground, 0.8))
                            .child(tracked_text(settled_text, TRACKING_WIDER)),
                    )
                    .child(
                        Button::new(SharedString::from(format!("agents-collapse-{id}")))
                            .variant(ButtonVariant::GhostMuted)
                            .size(ButtonSize::IconMicro)
                            .icon("chevron-down")
                            .icon_size(ICON_XS)
                            .accessibility_label(collapse_aria_label.clone())
                            .on_click(actions.handler(
                                "rightPanelAgentsToggleWorkflow",
                                json!({ "workflowId": id }),
                            )),
                    ),
            )
            .when(!rail.is_empty(), |this| this.child(phase_rail(rail, t)))
            .when_some(script.as_ref(), |this, script| {
                this.child(script_view(id, script, actions, t))
            })
            .children(
                phases
                    .iter()
                    .map(|phase| phase_section(id, phase, actions, t)),
            )
            .children(unphased_rows.iter().map(|row| agent_row(row, t)))
            .when_some(fallback_row.as_ref(), |this, row| {
                this.child(agent_row(row, t))
            })
            .into_any_element(),
        AgentWorkflowView::Collapsed {
            id,
            status_tone,
            title,
            failed_text,
            agents_text,
            tokens_text,
            elapsed_text,
        } => div()
            .child(
                div()
                    .id(SharedString::from(format!("agents-expand-{id}")))
                    .flex()
                    .w_full()
                    .items_center()
                    .gap(px(HEADER_GAP))
                    .rounded(px(radius::MD))
                    .px(px(SECTION_INSET_X))
                    .py(px(COLLAPSED_PADDING_Y))
                    .cursor_pointer()
                    .hover(|style| style.bg(fade(t.accent, 0.4)))
                    .child(status_dot(*status_tone, t))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .text_size(px(TEXT_SM))
                            .line_height(px(TEXT_SM_LINE))
                            .text_color(t.foreground)
                            .child(title.clone()),
                    )
                    .child(
                        mono(TEXT_2XS, TEXT_2XS_LINE)
                            .ml_auto()
                            .flex_none()
                            .flex()
                            .items_center()
                            .gap(px(COLLAPSED_META_GAP))
                            .text_color(fade(t.muted_foreground, 0.8))
                            .when_some(failed_text.clone(), |this, text| {
                                this.child(div().text_color(t.destructive_foreground).child(text))
                            })
                            .child(agents_text.clone())
                            .child(
                                div()
                                    .font_features(theme::tabular())
                                    .child(tokens_text.clone()),
                            )
                            .when_some(elapsed_text.clone(), |this, text| {
                                this.child(div().font_features(theme::tabular()).child(text))
                            })
                            .child(icon(
                                "chevron-right",
                                ICON_XS,
                                fade(t.muted_foreground, 0.8),
                            )),
                    )
                    .on_click(actions.handler(
                        "rightPanelAgentsToggleWorkflow",
                        json!({ "workflowId": id }),
                    )),
            )
            .into_any_element(),
    }
}

fn direct_section(direct: &AgentDirectSectionView, t: &Tokens) -> AnyElement {
    div()
        .child(
            eyebrow(t)
                .flex()
                .px(px(SECTION_INSET_X))
                .pt(px(DIRECT_PADDING_TOP))
                .child(tracked_text(&direct.title.to_uppercase(), TRACKING_WIDER)),
        )
        .children(direct.rows.iter().map(|row| agent_row(row, t)))
        .into_any_element()
}

fn footer(footer: &AgentsFooterView, t: &Tokens) -> AnyElement {
    mono(TEXT_2XS, TEXT_2XS_LINE)
        .flex_none()
        .flex()
        .items_center()
        .justify_between()
        .border_t_1()
        .border_color(fade(t.border, 0.6))
        .px(px(FOOTER_PADDING_X))
        .py(px(FOOTER_PADDING_Y))
        .text_color(t.muted_foreground)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(FOOTER_GAP))
                .when_some(footer.working_text.clone(), |this, text| {
                    this.child(div().text_color(t.info_foreground).child(text))
                })
                .when_some(footer.idle_text.clone(), |this, text| this.child(text))
                .when_some(footer.settled_text.clone(), |this, text| this.child(text)),
        )
        .child(
            div()
                .font_features(theme::tabular())
                .child(footer.total_tokens_text.clone()),
        )
        .into_any_element()
}

impl Render for AgentsSurface {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let actions = Actions {
            client: self.client.clone(),
        };
        let root = div().size_full().flex().flex_col().min_h_0();
        let Some(Some(view)) = self.state.read(cx).data.as_ref() else {
            return root;
        };
        match view {
            RightPanelAgentsView::Empty { empty } => root.child(empty_state(empty, &t)),
            RightPanelAgentsView::Agents {
                workflows,
                direct,
                footer: summary,
            } => root
                .child(
                    ScrollArea::new("agents-panel-scroll")
                        .flex_1()
                        .min_h_0()
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(LIST_GAP))
                                .p(px(LIST_PADDING))
                                .children(
                                    workflows
                                        .iter()
                                        .map(|workflow| workflow_section(workflow, &actions, &t)),
                                )
                                .when_some(direct.as_ref(), |this, direct| {
                                    this.child(direct_section(direct, &t))
                                }),
                        ),
                )
                .child(footer(summary, &t)),
        }
    }
}
