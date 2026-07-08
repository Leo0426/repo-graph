package com.repograph.taint.common;

import com.ibm.wala.types.Selector;

import java.util.Set;

public class Selectors {

	public static final Selector SEL_START = Selector.make("start()V");
	public static final Selector SEL_EXECUTOR_EXECUTE = Selector.make("execute(Ljava/lang/Runnable;)V");
	public static final Selector SEL_HANDLER_POST = Selector.make("post(Ljava/lang/Runnable;)Z");
	public static final Selector SEL_HANDLER_POST_AT_FRONT_OF_QUEUE = Selector.make("postAtFrontOfQueue(Ljava/lang/Runnable;)Z");
	public static final Selector SEL_HANDLER_POST_AT_TIME = Selector.make("postAtTime(Ljava/lang/Runnable;J)Z");
	public static final Selector SEL_HANDLER_POST_AT_TIME_WITH_TOKEN = Selector.make("postAtTime(Ljava/lang/Runnable;Ljava/lang/Object;J)Z");
	public static final Selector SEL_HANDLER_POST_DELAYED = Selector.make("postDelayed(Ljava/lang/Runnable;J)Z");
	public static final Selector SEL_HANDLER_SEND_EMPTY_MESSAGE = Selector.make("sendEmptyMessage(I)Z");
	public static final Selector SEL_HANDLER_SEND_EMPTY_MESSAGE_AT_TIME = Selector.make("sendEmptyMessageAtTime(IJ)Z");
	public static final Selector SEL_HANDLER_SEND_EMPTY_MESSAGE_DELAYED = Selector.make("sendEmptyMessageDelayed(IJ)Z");
	public static final Selector SEL_HANDLER_SEND_MESSAGE = Selector.make("postAtTime(Ljava/lang/Runnable;J)Z");
	public static final Selector SEL_HANDLER_SEND_MESSAGE_AT_FRONT_OF_QUEUE = Selector.make("sendMessageAtFrontOfQueue(Landroid/os/Message;)Z");
	public static final Selector SEL_HANDLER_SEND_MESSAGE_AT_TIME = Selector.make("sendMessageAtTime(Landroid/os/Message;J)Z");
	public static final Selector SEL_HANDLER_SEND_MESSAGE_DELAYED = Selector.make("sendMessageDelayed(Landroid/os/Message;J)Z");
	public static final Selector SEL_EXECUTE = Selector.make("execute([Ljava/lang/Object;)Landroid/os/AsyncTask;");
	public static final Selector SEL_RUN = Selector.make("run()V");
	public static final Selector SEL_HANDLER_HANDLE_MESSAGE = Selector.make("handleMessage(Landroid/os/Message;)V");
	public static final Selector SEL_DO_IN_BACKGROUND = Selector.make("doInBackground([Ljava/lang/Object;)Ljava/lang/Object;");
	public static final Selector SEL_SCHEDULE_LONG = Selector.make("schedule(Ljava/util/TimerTask;J)V");
	public static final Selector SEL_SCHEDULE_DATE = Selector.make("schedule(Ljava/util/TimerTask;Ljava/util/Date;)V");
	public static final Selector SEL_SCHEDULE_DATE_LONG = Selector.make("schedule(Ljava/util/TimerTask;Ljava/util/Date;J)V");
	public static final Selector SEL_SCHEDULE_LONG_LONG = Selector.make("schedule(Ljava/util/TimerTask;JJ)V");
	public static final Selector SEL_SCHEDULE_AT_FIXED_RATE_DATE = Selector.make("scheduleAtFixedRate(Ljava/util/TimerTask;Ljava/util/Date;J)V");
	public static final Selector SEL_SCHEDULE_AT_FIXED_RATE_LONG = Selector.make("scheduleAtFixedRate(Ljava/util/TimerTask;JJ)V");

	private static final Set<Selector> SPECIAL_EDGE_SELECTORS = Set.of(
		SEL_EXECUTOR_EXECUTE,
		SEL_HANDLER_POST,
		SEL_HANDLER_POST_AT_FRONT_OF_QUEUE,
		SEL_HANDLER_POST_AT_TIME,
		SEL_HANDLER_POST_AT_TIME_WITH_TOKEN,
		SEL_HANDLER_POST_DELAYED,
		SEL_SCHEDULE_LONG,
		SEL_SCHEDULE_DATE,
		SEL_SCHEDULE_DATE_LONG,
		SEL_SCHEDULE_LONG_LONG,
		SEL_SCHEDULE_AT_FIXED_RATE_DATE,
		SEL_SCHEDULE_AT_FIXED_RATE_LONG
	);

	private Selectors() {
		throw new UnsupportedOperationException("Selectors class cannot be instantiated");
	}

	/**
	 * Checks if the given pair of selectors (`var0` and `var1`) forms a special edge.
	 *
	 * @param selector1 the first selector
	 * @param selector2 the second selector
	 * @return true if it's a special edge, false otherwise
	 */
	public static boolean isSpecialEdge(Selector selector1, Selector selector2) {
		return SPECIAL_EDGE_SELECTORS.contains(selector1) && SEL_RUN.equals(selector2);
	}
}
