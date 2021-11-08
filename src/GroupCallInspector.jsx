import { Resizable } from "re-resizable";
import React, { useEffect, useState, useMemo } from "react";
import { useCallback } from "react";
import ReactJson from "react-json-view";

function getCallUserId(call) {
  return call.getOpponentMember()?.userId || call.invitee || null;
}

function getCallState(call) {
  return {
    id: call.callId,
    opponentMemberId: getCallUserId(call),
    state: call.state,
    direction: call.direction,
  };
}

function getHangupCallState(call) {
  return {
    ...getCallState(call),
    hangupReason: call.hangupReason,
  };
}

export function GroupCallInspector({ client, groupCall, show }) {
  const [roomStateEvents, setRoomStateEvents] = useState([]);
  const [toDeviceEvents, setToDeviceEvents] = useState([]);
  const [state, setState] = useState({
    userId: client.getUserId(),
  });

  const updateState = useCallback(
    (next) => setState((prev) => ({ ...prev, ...next })),
    []
  );

  useEffect(() => {
    function onUpdateRoomState(event) {
      if (event) {
        setRoomStateEvents((prev) => [
          ...prev,
          {
            eventType: event.getType(),
            stateKey: event.getStateKey(),
            content: event.getContent(),
          },
        ]);
      }

      const roomEvent = groupCall.room.currentState
        .getStateEvents("org.matrix.msc3401.call", groupCall.groupCallId)
        .getContent();

      const memberEvents = Object.fromEntries(
        groupCall.room.currentState
          .getStateEvents("org.matrix.msc3401.call.member")
          .map((event) => [event.getStateKey(), event.getContent()])
      );

      updateState({
        ["org.matrix.msc3401.call"]: roomEvent,
        ["org.matrix.msc3401.call.member"]: memberEvents,
      });
    }

    function onCallsChanged() {
      const calls = groupCall.calls.reduce((obj, call) => {
        obj[
          `${call.callId} (${call.getOpponentMember()?.userId || call.sender})`
        ] = getCallState(call);
        return obj;
      }, {});

      updateState({ calls });
    }

    function onCallHangup(call) {
      setState(({ hangupCalls, ...rest }) => ({
        ...rest,
        hangupCalls: {
          ...hangupCalls,
          [`${call.callId} (${
            call.getOpponentMember()?.userId || call.sender
          })`]: getHangupCallState(call),
        },
      }));
    }

    function onToDeviceEvent(event) {
      const eventType = event.getType();

      if (
        !(
          eventType.startsWith("m.call.") ||
          eventType.startsWith("org.matrix.call.")
        )
      ) {
        return;
      }

      const content = event.getContent();

      if (content.conf_id && content.conf_id !== groupCall.groupCallId) {
        return;
      }

      setToDeviceEvents((prev) => [
        ...prev,
        { eventType, content, sender: event.getSender() },
      ]);
    }

    client.on("RoomState.events", onUpdateRoomState);
    groupCall.on("calls_changed", onCallsChanged);
    client.on("state", onCallsChanged);
    client.on("hangup", onCallHangup);
    client.on("toDeviceEvent", onToDeviceEvent);

    onUpdateRoomState();
  }, [client, groupCall]);

  const toDeviceEventsByCall = useMemo(() => {
    const result = {};

    for (const event of toDeviceEvents) {
      const callId = event.content.call_id;
      const key = `${callId} (${event.sender})`;
      result[key] = result[key] || [];
      result[key].push(event);
    }

    return result;
  }, [toDeviceEvents]);

  useEffect(() => {
    let timeout;

    async function updateCallStats() {
      const callIds = groupCall.calls.map(
        (call) =>
          `${call.callId} (${call.getOpponentMember()?.userId || call.sender})`
      );
      const stats = await Promise.all(
        groupCall.calls.map((call) =>
          call.peerConn
            ? call.peerConn
                .getStats(null)
                .then((stats) =>
                  Object.fromEntries(
                    Array.from(stats).map(([_id, report], i) => [
                      report.type + i,
                      report,
                    ])
                  )
                )
            : Promise.resolve(null)
        )
      );

      const callStats = {};

      for (let i = 0; i < groupCall.calls.length; i++) {
        callStats[callIds[i]] = stats[i];
      }

      updateState({ callStats });
      timeout = setTimeout(updateCallStats, 1000);
    }

    if (show) {
      updateCallStats();
    }

    return () => {
      clearTimeout(timeout);
    };
  }, [show]);

  if (!show) {
    return null;
  }

  return (
    <Resizable enable={{ top: true }} defaultSize={{ height: 200 }}>
      <ReactJson
        theme="monokai"
        src={{
          ...state,
          roomStateEvents,
          toDeviceEvents,
          toDeviceEventsByCall,
        }}
        name={null}
        indentWidth={2}
        collapsed={1}
        displayDataTypes={false}
        displayObjectSize={false}
        enableClipboard={false}
        style={{ height: "100%", overflowY: "scroll" }}
      />
    </Resizable>
  );
}
